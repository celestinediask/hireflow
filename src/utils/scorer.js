const OpenAI = require('openai');

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
  return client;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return isNaN(n) ? min : Math.max(min, Math.min(max, n));
}

async function scoreCandidate(templateTitle, prescreening, responses, questions, session) {
  const qa = questions.map((q, i) => {
    const r = responses.find(r => r.question_id === q.id);
    return `Q${i + 1}: ${q.question_text}\nA${i + 1}: ${r ? r.response_text : '(no answer given)'}`;
  }).join('\n\n');

  const edu = prescreening
    ? [prescreening.qualification, prescreening.institution, prescreening.graduation_year].filter(Boolean).join(', ')
    : null;

  const lines = [];
  if (edu) lines.push(`Education: ${edu}`);
  if (prescreening?.work_experience) lines.push(`Work Experience:\n${prescreening.work_experience}`);
  if (prescreening?.last_ctc || prescreening?.inhand_salary || prescreening?.expected_salary)
    lines.push(`Compensation: Last CTC ${prescreening.last_ctc || 'N/A'}, In-Hand ${prescreening.inhand_salary || 'N/A'}, Expected ${prescreening.expected_salary || 'N/A'}, Notice ${prescreening.notice_period || 'N/A'}`);
  if (prescreening?.job_switches) lines.push(`Job Switches: ${prescreening.job_switches}`);
  if (prescreening?.reason_leaving) lines.push(`Reason for Leaving: ${prescreening.reason_leaving}`);
  if (prescreening?.career_changes) lines.push(`Career Changes: ${prescreening.career_changes}`);
  if (session.wpm) lines.push(`Typing Test: ${session.wpm} WPM, ${session.accuracy}% accuracy`);

  const candidateData = lines.length ? lines.join('\n') : 'No prescreening data available.';

  const prompt = `You are an expert HR recruiter. Score this candidate for the role of "${templateTitle}" on 5 factors, each out of 20 (total out of 100).

SCORING CRITERIA:
- experience (0-20): Years of relevant experience, career progression, seniority
- skills (0-20): Technical/domain skills relevant to this specific role
- stability (0-20): Job stability — consistent tenures, low job-hopping, clear career path
- communication (0-20): Clarity, depth, and professionalism of interview responses
- role_fit (0-20): Overall alignment of background, goals, and experience with this role

CANDIDATE DATA:
${candidateData}

INTERVIEW Q&A:
${qa || 'No interview responses recorded.'}

Respond with ONLY a valid JSON object, no explanation or other text:
{"experience": <0-20>, "skills": <0-20>, "stability": <0-20>, "communication": <0-20>, "role_fit": <0-20>, "notes": "<2-3 sentence summary of key strengths and concerns>"}`;

  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = completion.choices[0].message.content.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OpenAI returned no JSON: ' + text.slice(0, 200));

  const result = JSON.parse(match[0]);
  return {
    experience:    clampInt(result.experience, 0, 20),
    skills:        clampInt(result.skills, 0, 20),
    stability:     clampInt(result.stability, 0, 20),
    communication: clampInt(result.communication, 0, 20),
    role_fit:      clampInt(result.role_fit, 0, 20),
    notes:         String(result.notes || '').slice(0, 600),
  };
}

async function testApiKey() {
  await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Hi' }],
  });
}

module.exports = { scoreCandidate, testApiKey };
