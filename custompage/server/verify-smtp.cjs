'use strict';
const {loadConfig} = require('./config.cjs');
const {createMailer,mailError} = require('./mailer.cjs');
/**
 * Construye el transporte con secret.env para comprobar TLS y autenticación. verify no envía un mensaje;
 * los callbacks informan éxito/error y finally cierra el transporte.
 */
const smtp = createMailer(loadConfig().smtp);
smtp.verify().then(()=>console.log('Conexion TLS y autenticacion SMTP correctas. No se envio ningun correo.')).catch(error=>{console.error(mailError(error));process.exitCode=1;}).finally(()=>smtp.close());
