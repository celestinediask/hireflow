const express = require('express');
const crypto = require('crypto');
const { queries, DEFAULT_TYPING_TEXT } = require('../db');
const { requireHR } = require('../middleware/auth');
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

router.use(requireHR);

// Dashboard — list templates created by this HR user
router.get('/', async (req, res) => {
  try {
    const templates = await queries.getTemplatesByUser(req.user.id);
    res.render('hr/dashboard', { templates, user: req.user, title: 'HR Dash' });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// New template form
router.get('/templates/new', (req, res) => {
  res.render('hr/template-new');
});

// Create template
router.post('/templates', async (req, res) => {
  const { title, questions, duration_minutes, typing_text } = req.body;
  if (!title || !questions || !questions.trim()) {
    return res.render('hr/template-new', { error: 'Title and questions are required.' });
  }

  const lines = questions.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return res.render('hr/template-new', { error: 'At least one question is required.' });
  }

  try {
    const duration = parseInt(duration_minutes) || 30;
    const typingText = (typing_text && typing_text.trim()) ? typing_text.trim() : DEFAULT_TYPING_TEXT;
    const result = await queries.createTemplate(title.trim(), req.user.id, duration, typingText);
    const templateId = result.lastInsertRowid;
    await Promise.all(lines.map((text, i) => queries.createQuestion(templateId, i + 1, text)));
    res.redirect(303,`/hr/templates/${templateId}`);
  } catch (err) {
    console.error('Create template error:', err);
    res.render('hr/template-new', { error: 'Something went wrong.' });
  }
});

// Template detail
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const [sessions, scoredRows] = await Promise.all([
      queries.getSessionsByTemplate(template.id),
      queries.getScoredSessionsByTemplate(template.id),
    ]);
    const latestLink = sessions.find(s => s.status === 'pending') || null;

    const ranked = scoredRows
      .map(r => ({ ...r, effectiveTotal: effectiveTotal(r) }))
      .filter(r => r.effectiveTotal !== null)
      .sort((a, b) => b.effectiveTotal - a.effectiveTotal)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const baseUrl = req.protocol + '://' + req.get('host');
    res.render('hr/template-detail', {
      template, sessions, latestLink, linked: req.query.linked === '1',
      title: 'HR Dash', user: req.user, activePage: 'sessions', ranked, baseUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Questions page
router.get('/templates/:id/questions', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const questions = await queries.getQuestionsByTemplate(template.id);
    res.render('hr/template-questions', { template, questions, title: 'HR Dash', user: req.user, activePage: 'questions' });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// All links page
router.get('/templates/:id/links', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const sessions = await queries.getSessionsByTemplate(template.id);
    const pendingSessions = sessions.filter(s => s.status === 'pending');
    const baseUrl = req.protocol + '://' + req.get('host');
    res.render('hr/template-links', { template, pendingSessions, title: 'HR Dash', user: req.user, activePage: 'links', baseUrl });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Delete template
router.post('/templates/:id/delete', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    await queries.deleteTemplate(template.id);
    res.redirect(303,'/hr');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Generate interview link
router.post('/templates/:id/links', async (req, res) => {
  try {
    const template = await queries.getTemplateById(req.params.id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }
    const token = crypto.randomUUID();
    await queries.createSession(template.id, token);
    res.redirect(303,`/hr/templates/${template.id}?linked=1`);
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
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Session not found.' });
    }
    const [responses, questions, prescreening, score] = await Promise.all([
      queries.getResponsesBySession(session.id),
      queries.getQuestionsByTemplate(template.id),
      queries.getPrescreeningBySession(session.id),
      queries.getScoreBySession(session.id),
    ]);
    res.render('hr/session-detail', {
      session, template, responses, questions, prescreening, score,
      title: 'HR Dash', scored: req.query.scored === '1',
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
    if (!template || template.created_by !== req.user.id) {
      return res.status(404).render('error', { message: 'Template not found.' });
    }

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
    const template = await queries.getTemplateById(session.template_id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(403).render('error', { message: 'Access denied.' });
    }

    const { experience, skills, stability, communication, role_fit, override_total, notes, shortlisted } = req.body;
    const ot = override_total !== undefined && override_total !== '' ? clamp(override_total, 0, 100) : null;

    await queries.upsertScore(
      session.id,
      clamp(experience, 0, 20), clamp(skills, 0, 20), clamp(stability, 0, 20),
      clamp(communication, 0, 20), clamp(role_fit, 0, 20),
      ot, notes || null, shortlisted === 'on' ? 1 : 0
    );
    res.redirect(303,`/hr/sessions/${session.id}?scored=1`);
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
    const template = await queries.getTemplateById(session.template_id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(403).render('error', { message: 'Access denied.' });
    }
    await queries.updateHrNotes(session.id, req.body.hr_notes || null);
    res.redirect(303, `/hr/sessions/${session.id}?scored=1`);
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
    const template = await queries.getTemplateById(session.template_id);
    if (!template || template.created_by !== req.user.id) {
      return res.status(403).render('error', { message: 'Access denied.' });
    }
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
