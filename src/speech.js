import {listModels} from './llm.js';

export const DEFAULT_SPEECH_MODEL = 'gemini-3.8-flash-tts';
const reply = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
// Only this documented Gemini TTS wire family is compatible with Charon and speech_metadata.
export function compatibleSpeechModel(model) {
  return typeof model === 'string' && model.length <= 100
    && /^gemini-3\.8-flash(?:-lite)?-tts(?:-[a-z0-9-]+)?$/.test(model);
}
async function catalog(provider) {
  const result = await listModels(provider);
  if (result.status) return {response:reply({detail:result.status === 429
    ? 'Speech model discovery reached the provider quota. Try again later.'
    : 'Unable to refresh speech models. The selected voice has not changed.', code:'tts_catalog_unavailable'}, result.status === 429 ? 429 : 503)};
  return {models:result.models.filter(compatibleSpeechModel), truncated:result.truncated};
}

export async function speechResponse(body, apiKey) {
  const provider = {protocol:'gemini', baseUrl:'https://generativelanguage.googleapis.com', apiKey};
  if (!apiKey) return reply({detail:'Choose a Google Gemini API-key profile for Charon read-aloud. Antigravity chat is a separate connection.', code:'no_tts'}, 403);
  if (body.action === 'models') {
    const result = await catalog(provider);
    return result.response || reply({models:result.models, truncated:result.truncated, voice:'Charon', default_model:DEFAULT_SPEECH_MODEL, verified:false});
  }
  if (body.action !== undefined) return reply({detail:'Invalid speech action.'}, 400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 6000) return reply({detail:'Speech text must contain 1–6000 characters.'}, 400);
  const model = body.speech_model ?? DEFAULT_SPEECH_MODEL;
  if (!compatibleSpeechModel(model)) return reply({detail:'Choose a compatible Gemini TTS model in Sound settings.', code:'invalid_speech_model'}, 400);
  // Keep the current default stable. An explicitly selected alternative must be in this key's catalog.
  if (model !== DEFAULT_SPEECH_MODEL) {
    const result = await catalog(provider);
    if (result.response) return result.response;
    if (!result.models.includes(model)) return reply({detail:'The selected speech model is no longer listed. Choose another in Sound settings.', code:'speech_model_missing'}, 409);
  }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method:'POST', redirect:'manual', signal:AbortSignal.timeout(45000),
      headers:{'Content-Type':'application/json', 'x-goog-api-key':apiKey},
      body:JSON.stringify({
        contents:[{role:'user', parts:[{text, speech_metadata:{style:'Use one warm, natural male teacher voice. Speak Vietnamese explanations with natural Vietnamese pronunciation, and Japanese examples with standard Japanese pronunciation. Switch languages naturally without changing speaker. Use a measured conversational teaching pace.'}}]}],
        generationConfig:{responseModalities:['AUDIO'], speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Charon'}}}}
      })
    });
    if (!response.ok) {
      await response.body?.cancel();
      return reply({detail:response.status === 429
        ? 'Gemini speech reached a rate or quota limit (429). Chat and speech have separate quotas. No other voice was used.'
        : 'Unable to generate speech. The selected voice has not changed.', code:response.status === 429 ? 'tts_quota' : 'tts_unavailable'}, response.status === 429 ? 429 : 503);
    }
    const data = await response.json();
    const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
    if (typeof audio?.data !== 'string' || !audio.data) return reply({detail:'The speech provider returned no audio. Please try again.', code:'tts_unavailable'}, 503);
    return reply({audioBase64:audio.data, mimeType:audio.mimeType || 'audio/wav', voice:'Charon', model});
  } catch {
    return reply({detail:'Unable to generate speech. The selected voice has not changed.', code:'tts_unavailable'}, 503);
  }
}

// Official OpenAI speech uses the resolved profile; custom endpoints never receive speech credentials.
export async function openAISpeechResponse(body, provider) {
  if (body.action === 'models') return reply({models:['gpt-4o-mini-tts'],default_model:'gpt-4o-mini-tts',voice:'alloy',verified:false});
  if (body.action !== undefined) return reply({detail:'Invalid speech action.'},400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 6000) return reply({detail:'Speech text must contain 1–6000 characters.'},400);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${provider.apiKey}`},
      body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'alloy',input:text.slice(0,4000),response_format:'mp3'})
    });
    if (!response.ok) { await response.body?.cancel(); return reply({detail:'OpenAI speech is unavailable. Please try again.',code:'tts_unavailable'},response.status===429?429:503); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return reply({detail:'No speech audio was returned.',code:'tts_unavailable'},503);
    let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return reply({mimeType:'audio/mpeg',audioBase64:btoa(binary),voice:'alloy',model:'gpt-4o-mini-tts'});
  } catch { return reply({detail:'OpenAI speech is unavailable. Please try again.',code:'tts_unavailable'},503); }
}
