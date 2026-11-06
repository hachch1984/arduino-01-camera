'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseEnv} = require('node:util');
const loadConfig = () => {
  const file = path.join(__dirname, '../../secret.env');
  const env = {...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}), ...process.env};
  const camera = new URL(env.CAMERA_URL || 'http://10.150.195.3');
  if (camera.protocol !== 'http:' || camera.username || camera.password) throw new Error('CAMERA_URL debe ser una direccion HTTP de la camara.');
  return {
    camera, port:Number(env.WEB_PORT || 3000),
    smtp:{host:env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',port:Number(env.BREVO_SMTP_PORT || 587),
      login:env.BREVO_SMTP_LOGIN || '',key:env.BREVO_SMTP_KEY || '',sender:env.BREVO_SENDER_EMAIL || '',
      caFile:env.BREVO_SMTP_CA_FILE ? path.resolve(__dirname,'../..',env.BREVO_SMTP_CA_FILE) : ''},
  };
};
module.exports = {loadConfig};
