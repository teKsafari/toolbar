import { apiError } from '#lib/server/api.ts';

const missing = ({ params }: { params: { rest: string } }) => apiError(404, 'not_found', `No API route /api/v1/${params.rest}`);
export const GET = missing;
export const POST = missing;
export const PUT = missing;
export const PATCH = missing;
export const DELETE = missing;
