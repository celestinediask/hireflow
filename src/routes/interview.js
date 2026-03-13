const express = require('express');
const { queries, DEFAULT_TYPING_TEXT } = require('../db');
const supabase = require('../supabase');

const router = express.Router();

function sessionExpired(session) {
  if (!session.expires_at) return false;
  return Date.now() > new Date(session.expires_at).getTime();
}

function getSecondsRemaining(session, template) {
  if (!session.started_at) return template.duration_minutes * 60;
  const startedMs = new Date(session.started_at).getTime();
  const elapsed = Math.floor((Date.now() - startedMs) / 1000);
  return Math.max(0, template.duration_minutes * 60 - elapsed);
}

// Main interview router — serves all stages
router.get('/interview/:token', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session) return res.status(404).render('error', { message: 'Interview link not found.' });

    const template = await queries.getTemplateById(session.template_id);

    if (session.status === 'pending' && sessionExpired(session)) {
      return res.render('interview/expired', { template });
    }

    if (session.status === 'pending') {
      return res.render('interview/prescreening', { session, template, error: null });
    }

    if (session.status === 'prescreening_done') {
      return res.render('interview/start', { session, template });
    }

    if (session.status === 'in_progress') {
      const secondsLeft = getSecondsRemaining(session, template);
      if (secondsLeft <= 0) {
        await queries.setTypingTest(session.id);
        return res.redirect(`/interview/${session.token}`);
      }
      const [questions, responses] = await Promise.all([
        queries.getQuestionsByTemplate(session.template_id),
        queries.getResponsesBySession(session.id),
      ]);
      const currentQuestion = questions[session.current_question_index] || null;
      return res.render('interview/chat', { session, template, questions, responses, currentQuestion, secondsLeft });
    }

    if (session.status === 'typing_test') {
      const secondsLeft = getSecondsRemaining(session, template);
      const typingText = template.typing_text || DEFAULT_TYPING_TEXT;
      return res.render('interview/typing', { session, template, typingText, secondsLeft });
    }

    // completed
    const [prescreening, responses] = await Promise.all([
      queries.getPrescreeningBySession(session.id),
      queries.getResponsesBySession(session.id),
    ]);
    res.render('interview/completed', { session, template, prescreening, responses });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Get a Supabase signed upload URL for direct browser-to-storage resume upload
router.get('/interview/:token/upload-url', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session || session.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid session.' });
    }
    const path = `${req.params.token}.pdf`;
    const { data, error } = await supabase.storage
      .from('resumes')
      .createSignedUploadUrl(path, { upsert: true });
    if (error) {
      console.error('Signed URL error:', error);
      return res.status(500).json({ error: 'Failed to create upload URL.' });
    }
    res.json({ signedUrl: data.signedUrl, path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Submit prescreening form (resume already uploaded directly to Supabase by browser)
router.post('/interview/:token/prescreening', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session) return res.status(404).render('error', { message: 'Interview not found.' });
    if (session.status !== 'pending') return res.redirect(`/interview/${req.params.token}`);

    const template = await queries.getTemplateById(session.template_id);

    const {
      full_name, dob, phone, email, location,
      qualification, institution, graduation_year,
      work_experience, last_ctc, inhand_salary, expected_salary, notice_period,
      reason_leaving, job_switches, career_changes, resume_path,
    } = req.body;

    if (!full_name || !phone || !email) {
      return res.render('interview/prescreening', { session, template, error: 'Full name, phone and email are required.' });
    }
    if (!resume_path) {
      return res.render('interview/prescreening', { session, template, error: 'Please upload your resume in PDF format.' });
    }

    await queries.createPrescreening(
      session.id, resume_path, full_name, dob, phone, email, location,
      qualification, institution, graduation_year, work_experience,
      last_ctc, inhand_salary, expected_salary, notice_period,
      reason_leaving, job_switches, career_changes
    );
    await queries.savePrescreeningToSession(full_name.trim(), email.trim(), session.id);
    res.redirect(`/interview/${req.params.token}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Begin interview (start timer)
router.post('/interview/:token/begin', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session) return res.status(404).render('error', { message: 'Interview not found.' });
    if (session.status !== 'prescreening_done') return res.redirect(`/interview/${req.params.token}`);
    await queries.beginInterview(session.id);
    res.redirect(`/interview/${req.params.token}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// Submit a response
router.post('/interview/:token/respond', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status !== 'in_progress') return res.status(400).json({ error: 'Interview is not in progress.' });

    const template = await queries.getTemplateById(session.template_id);
    const secondsLeft = getSecondsRemaining(session, template);

    if (secondsLeft <= 0) {
      await queries.setTypingTest(session.id);
      return res.json({ redirect: `/interview/${session.token}` });
    }

    const questions = await queries.getQuestionsByTemplate(session.template_id);
    const currentQuestion = questions[session.current_question_index];
    if (!currentQuestion) return res.status(400).json({ error: 'No more questions.' });

    const { response } = req.body;
    if (!response || !response.trim()) return res.status(400).json({ error: 'Response is required.' });

    await queries.createResponse(session.id, currentQuestion.id, response.trim());

    const nextIndex = session.current_question_index + 1;
    await queries.advanceSession(nextIndex, session.id);

    if (nextIndex >= questions.length) {
      await queries.setTypingTest(session.id);
      return res.json({ typing: true });
    }

    const nextQuestion = questions[nextIndex];
    res.json({
      done: false,
      questionNumber: nextIndex + 1,
      totalQuestions: questions.length,
      questionText: nextQuestion.question_text,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Submit typing test
router.post('/interview/:token/typing', async (req, res) => {
  try {
    const session = await queries.getSessionByToken(req.params.token);
    if (!session) return res.status(404).render('error', { message: 'Interview not found.' });
    if (session.status !== 'typing_test') return res.redirect(`/interview/${req.params.token}`);

    const template = await queries.getTemplateById(session.template_id);
    const typingText = template.typing_text || DEFAULT_TYPING_TEXT;

    const { typed_text, elapsed_seconds } = req.body;
    const typed = (typed_text || '').trim();
    const elapsed = Math.max(1, parseInt(elapsed_seconds) || 1);

    const wordCount = typed.length / 5;
    const minutes = elapsed / 60;
    const wpm = Math.round(wordCount / minutes);

    let correct = 0;
    const compareLen = Math.min(typingText.length, typed.length);
    for (let i = 0; i < compareLen; i++) {
      if (typingText[i] === typed[i]) correct++;
    }
    const accuracy = typingText.length > 0
      ? Math.round((correct / typingText.length) * 100)
      : 0;

    await queries.completeSession(wpm, accuracy, session.id);
    res.redirect(`/interview/${req.params.token}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

module.exports = router;
