const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool, queries, DEFAULT_TYPING_TEXT } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { scoreCandidate, testApiKey } = require('../utils/scorer');
const supabase = require('../supabase');

const router = express.Router();

function effectiveTotal(row) {
  if (row.experience == null) return null;
  if (row.override_total != null) return row.override_total;
  return (row.experience || 0) + (row.skills || 0) + (row.stability || 0) + (row.communication || 0) + (row.role_fit || 0);
}

function clamp(val, min, max) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

router.use(requireAdmin);

// Dashboard — HR user list
router.get('/', async (req, res) => {
  try {
    const hrUsers = await queries.getAllHRUsers();
    res.render('admin/dashboard', { hrUsers, user: req.user, title: 'Admin', success: null, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Profile page
router.get('/profile', (req, res) => {
  res.render('admin/profile', { user: req.user, title: 'Admin', success: null, error: null, plainPassword: req.session.adminPlainPassword || null });
});

// Reveal HR user password
router.post('/hr/:id/reveal', async (req, res) => {
  try {
    const hrUser = await queries.findById(req.params.id);
    if (!hrUser || hrUser.role !== 'hr') return res.status(404).render('error', { message: 'HR user not found.' });
    const { password } = req.body;
    if (!password) return res.render('admin/hr-form', { hrUser, error: 'Enter the current password.', title: 'Admin' });
    const match = await bcrypt.compare(password, hrUser.password_hash);
    if (!match) return res.render('admin/hr-form', { hrUser, error: 'Password is incorrect.', title: 'Admin' });
    await queries.storePlainPassword(password, hrUser.id);
    const updated = await queries.findById(hrUser.id);
    res.render('admin/hr-form', { hrUser: updated, error: null, title: 'Admin' });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Change admin credentials
router.post('/profile', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !username.trim() || !email || !email.trim()) {
    return res.render('admin/profile', { user: req.user, title: 'Admin', error: 'Username and email are required.', success: null });
  }
  try {
    if (password && password.trim()) {
      const passwordHash = await bcrypt.hash(password, 10);
      await queries.updateAdminUser(username.trim(), email.trim(), passwordHash, password, req.user.id, 'admin');
      req.session.adminPlainPassword = password.trim();
    } else {
      await queries.updateAdminUserNoPassword(username.trim(), email.trim(), req.user.id, 'admin');
    }
    const updatedUser = await queries.findById(req.user.id);
    res.render('admin/profile', { user: updatedUser, title: 'Admin', success: 'Credentials updated.', error: null, plainPassword: req.session.adminPlainPassword || null });
  } catch (err) {
    console.error('Update admin error:', err);
    res.render('admin/profile', { user: req.user, title: 'Admin', error: 'Something went wrong.', success: null, plainPassword: req.session.adminPlainPassword || null });
  }
});

// --- HR Management ---

// List HR users
router.get('/hr', async (req, res) => {
  try {
    const hrUsers = await queries.getAllHRUsers();
    res.render('admin/hr-list', { hrUsers });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// New HR form
router.get('/hr/new', (req, res) => {
  res.render('admin/hr-form', { hrUser: null, error: null, title: 'Admin' });
});

// Create HR user
router.post('/hr', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.render('admin/hr-form', { hrUser: null, error: 'All fields are required.', title: 'Admin' });
  }

  try {
    const existing = await queries.findByEmail(email);
    if (existing) {
      return res.render('admin/hr-form', { hrUser: null, error: 'Email is already in use.', title: 'Admin' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await queries.createHRUser(username.trim(), email.trim(), passwordHash, password);
    res.redirect(303,'/admin');
  } catch (err) {
    console.error('Create HR user error:', err);
    res.render('admin/hr-form', { hrUser: null, error: 'Something went wrong.', title: 'Admin' });
  }
});

// Edit HR form
router.get('/hr/:id/edit', async (req, res) => {
  try {
    const hrUser = await queries.findById(req.params.id);
    if (!hrUser || hrUser.role !== 'hr') {
      return res.status(404).render('error', { message: 'HR user not found.' });
    }
    res.render('admin/hr-form', { hrUser, error: null, title: 'Admin' });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Update HR user
router.post('/hr/:id', async (req, res) => {
  try {
    const hrUser = await queries.findById(req.params.id);
    if (!hrUser || hrUser.role !== 'hr') {
      return res.status(404).render('error', { message: 'HR user not found.' });
    }

    const { username, email, password } = req.body;
    if (!username || !email) {
      return res.render('admin/hr-form', { hrUser, error: 'Username and email are required.', title: 'Admin' });
    }

    const existing = await queries.findByEmail(email);
    if (existing && existing.id !== hrUser.id) {
      return res.render('admin/hr-form', { hrUser, error: 'Email is already in use.', title: 'Admin' });
    }

    if (password && password.trim()) {
      const passwordHash = await bcrypt.hash(password, 10);
      await queries.updateHRUser(username.trim(), email.trim(), passwordHash, password, hrUser.id, 'hr');
    } else {
      await queries.updateHRUserNoPassword(username.trim(), email.trim(), hrUser.id, 'hr');
    }
    res.redirect(303,'/admin');
  } catch (err) {
    console.error('Update HR user error:', err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Login as HR user
router.get('/hr/:id/login-as', async (req, res) => {
  try {
    const hrUser = await queries.findById(req.params.id);
    if (!hrUser || hrUser.role !== 'hr') return res.status(404).render('error', { message: 'HR user not found.' });
    req.session.hrUserId = hrUser.id;
    res.redirect('/hr');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Delete HR user
router.post('/hr/:id/delete', async (req, res) => {
  try {
    const hrUser = await queries.findById(req.params.id);
    if (!hrUser || hrUser.role !== 'hr') return res.redirect(303,'/admin');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const templates = await queries.getTemplatesByUser(hrUser.id);
      for (const t of templates) {
        const sessions = await queries.getSessionsByTemplate(t.id);
        for (const s of sessions) {
          await client.query('DELETE FROM interview_responses WHERE session_id = $1', [s.id]);
        }
        await client.query('DELETE FROM interview_sessions WHERE template_id = $1', [t.id]);
      }
      await client.query('DELETE FROM interview_templates WHERE created_by = $1', [hrUser.id]);
      await client.query("DELETE FROM users WHERE id = $1 AND role = 'hr'", [hrUser.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.redirect(303,'/admin');
  } catch (err) {
    console.error('Delete HR user error:', err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// --- Templates ---

// New template form
router.get('/templates/new', (req, res) => {
  res.render('admin/template-new');
});

// Create template
router.post('/templates', async (req, res) => {
  const { title, questions, duration_minutes, typing_text } = req.body;
  if (!title || !questions || !questions.trim()) {
    return res.render('admin/template-new', { error: 'Title and questions are required.' });
  }

  const lines = questions.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return res.render('admin/template-new', { error: 'At least one question is required.' });
  }

  try {
    const duration = parseInt(duration_minutes) || 30;
    const typingText = (typing_text && typing_text.trim()) ? typing_text.trim() : DEFAULT_TYPING_TEXT;
    const result = await queries.createTemplate(title.trim(), req.user.id, duration, typingText);
    const templateId = result.lastInsertRowid;
    await Promise.all(lines.map((text, i) => queries.createQuestion(templateId, i + 1, text)));
    res.redirect(303,`/admin/templates/${templateId}`);
  } catch (err) {
    console.error('Create template error:', err);
    res.render('admin/template-new', { error: 'Something went wrong.' });
  }
});

// Template detail
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const [questions, sessions, scoredRows] = await Promise.all([
      queries.getQuestionsByTemplate(template.id),
      queries.getSessionsByTemplate(template.id),
      queries.getScoredSessionsByTemplate(template.id),
    ]);

    const ranked = scoredRows
      .map(r => ({ ...r, effectiveTotal: effectiveTotal(r) }))
      .filter(r => r.effectiveTotal !== null)
      .sort((a, b) => b.effectiveTotal - a.effectiveTotal)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const baseUrl = req.protocol + '://' + req.get('host');
    res.render('admin/template-detail', { template, questions, sessions, linked: req.query.linked === '1', ranked, BASE_URL: baseUrl });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Delete template
router.post('/templates/:id/delete', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    await queries.deleteTemplate(template.id);
    res.redirect(303,'/admin');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Generate interview link
router.post('/templates/:id/links', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const token = crypto.randomUUID();
    await queries.createSession(template.id, token);
    res.redirect(303,`/admin/templates/${template.id}?linked=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// View session transcript
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await queries.getSessionById(req.params.id);
    if (!session) {
      return res.status(404).render('error', { message: 'Session not found.' });
    }
    const template = await queries.getTemplateById(session.template_id);
    if (!template) {
      return res.status(404).render('error', { message: 'Session not found.' });
    }
    const [responses, questions, prescreening, score] = await Promise.all([
      queries.getResponsesBySession(session.id),
      queries.getQuestionsByTemplate(template.id),
      queries.getPrescreeningBySession(session.id),
      queries.getScoreBySession(session.id),
    ]);
    res.render('admin/session-detail', {
      session, template, responses, questions, prescreening, score,
      title: 'Admin', scored: req.query.scored === '1',
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Auto-score all completed candidates for a template using AI
router.post('/templates/:id/auto-score', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template) return res.status(404).render('error', { message: 'Template not found.' });

    try {
      await testApiKey();
    } catch (err) {
      console.error('API key test failed:', err.message);
      return res.status(503).json({ error: 'API key is invalid or not configured. Please check OPENAI_API_KEY.' });
    }

    const [questions, sessions] = await Promise.all([
      queries.getQuestionsByTemplate(template.id),
      queries.getSessionsByTemplate(template.id),
    ]);
    const completed = sessions.filter(s => s.status === 'completed');

    const results = await Promise.allSettled(completed.map(async (session) => {
      const [prescreening, responses, existing] = await Promise.all([
        queries.getPrescreeningBySession(session.id),
        queries.getResponsesBySession(session.id),
        queries.getScoreBySession(session.id),
      ]);
      const result = await scoreCandidate(template.title, prescreening, responses, questions, session);
      await queries.upsertScore(
        session.id,
        result.experience, result.skills, result.stability, result.communication, result.role_fit,
        existing ? existing.override_total : null,
        result.notes,
        existing ? existing.shortlisted : 0
      );
    }));

    const scored = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    results.filter(r => r.status === 'rejected').forEach((r, i) => {
      console.error('Auto-score failed for session', completed[i]?.id, ':', r.reason?.message);
    });

    res.json({ scored, failed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Save / update candidate score
router.post('/sessions/:id/score', async (req, res) => {
  try {
    const session = await queries.getSessionById(req.params.id);
    if (!session) return res.status(404).render('error', { message: 'Session not found.' });

    const { experience, skills, stability, communication, role_fit, override_total, notes, shortlisted } = req.body;
    const ot = override_total !== undefined && override_total !== '' ? clamp(override_total, 0, 100) : null;

    await queries.upsertScore(
      session.id,
      clamp(experience, 0, 20), clamp(skills, 0, 20), clamp(stability, 0, 20),
      clamp(communication, 0, 20), clamp(role_fit, 0, 20),
      ot, notes || null, shortlisted === 'on' ? 1 : 0
    );
    res.redirect(303,`/admin/sessions/${session.id}?scored=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Save HR notes
router.post('/sessions/:id/hr-notes', async (req, res) => {
  try {
    const session = await queries.getSessionById(req.params.id);
    if (!session) return res.status(404).render('error', { message: 'Session not found.' });
    await queries.updateHrNotes(session.id, req.body.hr_notes || null);
    res.redirect(303, `/admin/sessions/${session.id}?scored=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Download resume (redirects to Supabase signed URL)
router.get('/sessions/:id/resume', async (req, res) => {
  try {
    const session = await queries.getSessionById(req.params.id);
    if (!session) return res.status(404).render('error', { message: 'Session not found.' });
    const prescreening = await queries.getPrescreeningBySession(session.id);
    if (!prescreening || !prescreening.resume_path) {
      return res.status(404).render('error', { message: 'Resume not found.' });
    }
    const { data, error } = await supabase.storage
      .from('resumes')
      .createSignedUrl(prescreening.resume_path, 60);
    if (error || !data) {
      return res.status(404).render('error', { message: 'Resume not found.' });
    }
    res.redirect(303,data.signedUrl);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

module.exports = router;
