import {sessionUser} from './auth.js';
import {resolveProvider} from './providers.js';
import {rateLimited} from './ai-usage.js';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const MAX_AUDIO=2*1024*1024;
const formats={'audio/webm':'webm','audio/mp4':'mp4','audio/ogg':'ogg','audio/wav':'wav','audio/mpeg':'mp3'};
function audioBytes(data,mime) {
  if(typeof data!=='string' || !data.length || data.length>Math.ceil(MAX_AUDIO/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))return null;
  let bytes;try{bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));}catch{return null;}
  if(bytes.length<12 || bytes.length>MAX_AUDIO)return null;
  const ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
  const valid=mime==='audio/webm'?bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3
    :mime==='audio/mp4'?ascii(4,4)==='ftyp':mime==='audio/ogg'?ascii(0,4)==='OggS'
    :mime==='audio/wav'?ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE'
    :mime==='audio/mpeg'&&(ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
  return valid?bytes:null;
}
export async function transcriptionRoute(request,env) {
  const user=await sessionUser(request,env);
  if(!user)return json({detail:'Đăng nhập để nhập bằng giọng nói.'},401);
  if(request.headers.get('X-VJBot-Account')!==user.user_id)return json({detail:'Tài khoản đã thay đổi. Hãy tải lại.'},409);
  if(request.method!=='POST')return json({detail:'Method not allowed'},405);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>3*1024*1024)return json({detail:'Bản ghi quá lớn. Ghi tối đa 60 giây.'},413);
  let data;try{data=JSON.parse(raw);}catch{return json({detail:'Dữ liệu không hợp lệ.'},400);}
  if(!data || typeof data!=='object' || Array.isArray(data))return json({detail:'Dữ liệu không hợp lệ.'},400);
  const profileId=request.headers.get('X-VJBot-Profile')??undefined;
  const provider=await resolveProvider(env,user.user_id,data.api_connection,profileId);
  // STT follows the explicit chat connection, never the independent Sound selection.
  const selected=provider?.source==='platform' || profileId!==undefined || data.api_connection!==undefined;
  const supported=selected && provider?.protocol==='openai' && provider.baseUrl==='https://api.openai.com/v1' && !provider.error;
  if(data.action==='capabilities')return json({supported,model:supported?'gpt-transcribe':null});
  if(!supported)return json({detail:'Kết nối OpenAI chính thức để chép lời, hoặc nhập câu trả lời.',code:'no_transcription'},403);
  const mime=typeof data.mime_type==='string'?data.mime_type.split(';')[0].toLowerCase():'';
  if(!Object.hasOwn(formats,mime))return json({detail:'Định dạng âm thanh không được hỗ trợ.'},400);
  const bytes=audioBytes(data.audio,mime);
  if(!bytes)return json({detail:'Bản ghi không hợp lệ hoặc quá lớn.'},400);
  if(await rateLimited(env,user.user_id))return json({detail:'Đợi một phút rồi thử lại.'},429);
  const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),'recording.'+formats[mime]);form.set('model','gpt-transcribe');
  try {
    const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',redirect:'manual',
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(25000)]),headers:{Authorization:`Bearer ${provider.apiKey}`},body:form});
    if(!response.ok)return json({detail:response.status===429?'OpenAI đang giới hạn lượt dùng. Hãy thử lại sau.':'Chưa chép được bản ghi. Thử lại hoặc nhập câu trả lời.'},response.status===429?429:503);
    const result=await response.json();
    if(typeof result.text!=='string' || result.text.length>6000)return json({detail:'Bản chép lời không hợp lệ.'},502);
    return json({text:result.text.trim()});
  }catch{return json({detail:'Kết nối chép lời hết thời gian. Thử lại hoặc nhập câu trả lời.'},504);}
}
