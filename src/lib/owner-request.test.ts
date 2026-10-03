import {afterEach,expect,it} from 'vitest';
import {readOwnerMutationJson} from './owner-request';
afterEach(()=>{delete process.env.AUTH_URL;});
it('uses configured origins, not arbitrary request hosts',async()=>{
 process.env.AUTH_URL='https://reidar.tech';
 for(const origin of [null,'null','https://evil.test'])await expect(readOwnerMutationJson(new Request('https://evil.test/api/data/projects',{method:'PUT',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:'{}'}))).rejects.toMatchObject({status:403});
 expect(await readOwnerMutationJson(new Request('https://reidar.tech/api/data/projects',{method:'PUT',headers:{'content-type':'application/json',origin:'https://reidar.tech'},body:'{}'}))).toEqual({});
});
it('bounds streaming bodies and malformed JSON',async()=>{
 process.env.AUTH_URL='https://reidar.tech';let cancelled=false;
 const body=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 const init:RequestInit&{duplex:'half'}={method:'PUT',headers:{origin:'https://reidar.tech','content-type':'application/json'},body,duplex:'half'};
 await expect(readOwnerMutationJson(new Request('https://reidar.tech/api/data/projects',init))).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);
 await expect(readOwnerMutationJson(new Request('https://reidar.tech/api/data/projects',{method:'PUT',headers:{origin:'https://reidar.tech','content-type':'application/json'},body:'{'}))).rejects.toMatchObject({status:400});
});
