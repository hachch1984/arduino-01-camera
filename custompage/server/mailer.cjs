'use strict';
const nodemailer = require('nodemailer');
const fs = require('node:fs');
const tls = require('node:tls');
const {X509Certificate} = require('node:crypto');
const createMailer = smtp => nodemailer.createTransport({
  host:smtp.host,port:smtp.port,secure:smtp.port===465,requireTLS:true,
  auth:{user:smtp.login,pass:smtp.key},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,
    ...(smtp.caFile ? {ca:[...tls.rootCertificates,new X509Certificate(fs.readFileSync(smtp.caFile)).toString()]} : {})},
  connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
});
const mailError = error => {
  if (/Unauthorized IP address/i.test(error.response || error.message || '')) return 'Brevo bloqueo la IP publica de esta conexion. Agregala a las IP autorizadas de SMTP en Brevo.';
  if (error.code==='EAUTH') return 'Brevo rechazo el acceso SMTP. Revisa el login, la clave y las IP autorizadas.';
  if (/certificate|self.signed|issuer|trust/i.test(error.message || '') || error.code==='ETLS') return 'No se pudo verificar el certificado TLS de Brevo. Revisa la inspeccion SMTP del antivirus; no se desactivo la validacion TLS.';
  if (error.code==='EENVELOPE') return 'Brevo rechazo el remitente o un destinatario. Comprueba que el remitente este verificado.';
  return 'No se confirmo el envio. Revisa los registros de Brevo antes de reintentar para evitar duplicados.';
};
module.exports = {createMailer,mailError};
