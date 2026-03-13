const express = require('express');
const bcrypt = require('bcrypt');
const { queries } = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'All fields are required.' });
  }

  try {
    const user = await queries.findByEmail(email);
    if (!user) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    if (user.role !== 'admin' && user.role !== 'hr') {
      return res.render('login', { error: 'Your account does not have access. Contact an administrator.' });
    }

    if (user.role === 'admin') {
      req.session.adminUserId = user.id;
      req.session.adminPlainPassword = password;
      return req.session.save(() => res.redirect(303, '/admin'));
    }
    req.session.hrUserId = user.id;
    return req.session.save(() => res.redirect(303, '/hr'));
  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', { error: 'Something went wrong. Please try again.' });
  }
});

router.post('/admin/logout', (req, res) => {
  delete req.session.adminUserId;
  req.session.save(() => res.redirect(303, '/login'));
});

router.post('/hr/logout', (req, res) => {
  delete req.session.hrUserId;
  req.session.save(() => res.redirect(303, '/login'));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(303, '/login');
  });
});

module.exports = router;
