// 수집기 시작 (02 문서 1장). TYCOON_PORT·TYCOON_DB로 바꿀 수 있다
import { COLLECTOR_PORT } from '@tycoon/core';
import { DB_PATH } from './db';
import { startServer } from './http';

const port = Number(process.env.TYCOON_PORT ?? COLLECTOR_PORT);
await startServer(port, DB_PATH);
console.log(`collector 127.0.0.1:${port} · ${DB_PATH}`);
