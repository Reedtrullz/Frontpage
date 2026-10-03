export class OwnerRequestError extends Error {
  constructor(readonly status: number, message: string) {super(message);}
}
export async function readOwnerMutationJson(request?: Request): Promise<unknown> {
  if(!request) throw new OwnerRequestError(400,'A reviewed request is required.');
  const origins=(process.env.OWNER_MUTATION_ORIGINS ?? process.env.AUTH_URL ?? 'https://reidar.tech').split(',').map(value=>{try{return new URL(value.trim()).origin;}catch{return '';}}).filter(Boolean);
  const origin=request.headers.get('origin');
  if(!origin || origin === 'null' || !origins.includes(origin)) throw new OwnerRequestError(403,'The request origin is not allowed.');
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new OwnerRequestError(400,'A JSON request is required.');
  const cap=4*1024*1024;
  const length=request.headers.get('content-length');
  if(length && /^\d+$/.test(length) && Number(length)>cap){await request.body?.cancel();throw new OwnerRequestError(413,'The request is too large.');}
  if(!request.body) throw new OwnerRequestError(400,'A JSON body is required.');
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>cap){await reader.cancel();throw new OwnerRequestError(413,'The request is too large.');}chunks.push(result.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new OwnerRequestError(400,'Invalid JSON body.');}
}
