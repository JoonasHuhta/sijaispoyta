import { env } from 'cloudflare:workers';
import { handleApi } from '../../../server/board.js';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleApi(request, env);
export const POST = (request: Request) => handleApi(request, env);
