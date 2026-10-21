'use strict';
const db = require('../src/db');
db.migrate().then(() => { console.log('Database is up to date.'); return db.pool.end(); }).catch(e => { console.error(e.message); process.exit(1); });
