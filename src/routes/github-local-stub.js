const express = require('express');

const router = express.Router();

const disabledResponse = {
  error: 'GitHub OAuth deshabilitado en modo local',
  code: 'LOCAL_MODE_GITHUB_DISABLED'
};

router.all('*', (req, res) => {
  if (req.path.includes('status')) {
    return res.status(200).json({
      connected: false,
      disabled: true
    });
  }

  return res.status(501).json(disabledResponse);
});

module.exports = router;
