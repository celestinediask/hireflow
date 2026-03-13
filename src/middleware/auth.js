const { queries } = require('../db');

async function requireAdmin(req, res, next) {
  if (!req.session.adminUserId) {
    return res.redirect('/login');
  }
  const user = await queries.findById(req.session.adminUserId);
  if (!user || user.role !== 'admin') {
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

async function requireHR(req, res, next) {
  if (!req.session.hrUserId) {
    return res.redirect('/login');
  }
  const user = await queries.findById(req.session.hrUserId);
  if (!user || user.role !== 'hr') {
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

module.exports = { requireAdmin, requireHR };
