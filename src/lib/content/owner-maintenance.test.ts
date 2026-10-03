import {generateKeyPair, SignJWT, createLocalJWKSet, exportJWK} from 'jose';
import {expect,it} from 'vitest';
import {authorizeOwnerMaintenance} from './owner-maintenance';
it('requires configured operator host, separate secret, signed Access identity and audience',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='fixture';
 const key=createLocalJWKSet({keys:[jwk]}),env={OWNER_OPERATOR_HOST:'operator.example.test',OWNER_MAINTENANCE_SECRET:'separate-synthetic-token',OWNER_ACCESS_TEAM:'fixture.cloudflareaccess.com',OWNER_ACCESS_AUD:'operator-aud'};
 const token=await new SignJWT({type:'app'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://fixture.cloudflareaccess.com').setSubject('operator-fixture').setAudience('operator-aud').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const headers={Authorization:'Bearer separate-synthetic-token','Cf-Access-Jwt-Assertion':token};
 expect(await authorizeOwnerMaintenance(new Request('https://operator.example.test/__operator/owner-state',{headers}),env,key)).toBe(true);
 expect(await authorizeOwnerMaintenance(new Request('https://reidar.tech/__operator/owner-state',{headers}),env,key)).toBe(false);
 expect(await authorizeOwnerMaintenance(new Request('https://reidar.tech/__operator/owner-state',{headers}),{...env,OWNER_OPERATOR_HOST:'reidar.tech'},key)).toBe(false);
 expect(await authorizeOwnerMaintenance(new Request('https://operator.example.test/__operator/owner-state',{headers:{...headers,Authorization:'Bearer collector-token'}}),env,key)).toBe(false);
 expect(await authorizeOwnerMaintenance(new Request('https://operator.example.test/__operator/owner-state',{headers}),{...env,OWNER_ACCESS_AUD:'wrong'},key)).toBe(false);
 expect(await authorizeOwnerMaintenance(new Request('https://operator.example.test/__operator/owner-state',{headers:{...headers,'Cf-Access-Jwt-Assertion':'forged'}}),env,key)).toBe(false);
 const service=await new SignJWT({type:'app',common_name:'fixture.access'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://fixture.cloudflareaccess.com').setSubject('').setAudience('operator-aud').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const serviceRequest=new Request('https://operator.example.test/__operator/owner-state',{headers:{...headers,'Cf-Access-Jwt-Assertion':service}});
 expect(await authorizeOwnerMaintenance(serviceRequest,{...env,OWNER_ACCESS_SERVICE_ID:'fixture.access'},key)).toBe(true);
 expect(await authorizeOwnerMaintenance(serviceRequest,{...env,OWNER_ACCESS_SERVICE_ID:'wrong.access'},key)).toBe(false);

});
