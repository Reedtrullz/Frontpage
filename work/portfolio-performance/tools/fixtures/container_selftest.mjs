// Authored correctness fixture, never a product performance observation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import dns from 'node:dns/promises';
import {spawn} from 'node:child_process';

if (process.argv[2] === 'child') {
  process.send({pid:process.pid,session:fs.readFileSync('/proc/self/stat','utf8')});
  setTimeout(()=>process.exit(0),30000);
} else {
  const request=JSON.parse(process.env.MEASURE_REQUEST);
  const numbers=fs.readFileSync('/work/numbers.txt','utf8').trim().split(/\s+/).map(Number);
  assert.equal(numbers.reduce((a,b)=>a+b,0),55);
  fs.writeFileSync('/tmp/owned','positive');
  assert.equal(fs.readFileSync('/tmp/owned','utf8'),'positive');
  assert.throws(()=>fs.readFileSync(process.argv[2]),/ENOENT|EACCES/);
  assert.throws(()=>fs.writeFileSync('/work/numbers.txt','bad'),/EROFS|EACCES/);
  assert.throws(()=>fs.writeFileSync('/unmounted','bad'),/EROFS|EACCES/);
  fs.symlinkSync(process.argv[2],'/tmp/escape');
  assert.throws(()=>fs.readFileSync('/tmp/escape'),/ENOENT|EACCES/);
  fs.unlinkSync('/tmp/escape');
  const server=dgram.createSocket('udp4'), client=dgram.createSocket('udp4');
  await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
  const packet=new Promise(resolve=>server.once('message',resolve));
  await new Promise((resolve,reject)=>client.send('ok',server.address().port,'127.0.0.1',e=>e?reject(e):resolve()));
  assert.equal((await packet).toString(),'ok');server.close();client.close();
  await new Promise((resolve,reject)=>{
    const socket=net.connect({host:'192.0.2.1',port:9});
    socket.setTimeout(500,()=>{socket.destroy();reject(Error('TCP denial was only a timeout'));});
    socket.on('error',e=>{assert.match(e.code,/ENETUNREACH|EHOSTUNREACH/);resolve();});
    socket.on('connect',()=>{socket.destroy();reject(Error('external TCP connected'));});
  });
  const udp=dgram.createSocket('udp4');
  await new Promise((resolve,reject)=>udp.send('deny',9,'198.51.100.1',e=>e?resolve():reject(Error('UDP sent'))));
  udp.close();
  const resolver=new dns.Resolver({timeout:50,tries:1});resolver.setServers(['192.0.2.1']);
  await assert.rejects(resolver.resolve4('authored.invalid'));
  let child;
  if (['detached','timeout'].includes(request.scenario)) {
    child=spawn(process.execPath,[process.argv[1],'child'],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
    const identity=await new Promise(resolve=>child.once('message',resolve));
    process.stderr.write(JSON.stringify({child:identity})+'\n');child.disconnect();child.unref();
  }
  if(request.scenario==='timeout') await new Promise(resolve=>setTimeout(resolve,30000));
  if(request.scenario==='scratch')fs.writeFileSync('/tmp/overflow',Buffer.alloc(10*1024*1024));
  process.stdout.write(JSON.stringify({...request,status:'complete',capabilities:['sum'],
    semanticDigest:crypto.createHash('sha256').update('55').digest('hex'),
    metrics:{iterations:{scope:'invocation',unit:'count',values:[request.phase==='baseline'?60:30]},
             outputs:{scope:'invocation',unit:'count',values:[1]}}}));
}
