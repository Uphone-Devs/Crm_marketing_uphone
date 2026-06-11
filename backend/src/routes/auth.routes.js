/**
 * auth.routes.js — POST /api/auth/login
 */

const { Router } = require('express');
const authService = require('../services/auth.service');

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
