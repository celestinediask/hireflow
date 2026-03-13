const { initDB } = require('../src/db');
const app = require('../src/app');

let dbInitialized = false;

module.exports = async (req, res) => {
  if (!dbInitialized) {
    await initDB();
    dbInitialized = true;
  }
  return app(req, res);
};
