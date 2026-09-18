// Optional live Azure smoke check.
// Explicit opt-in only. Sends a synthetic sentence, NOT meeting notes or child data.
// node --env-file=.env.local scripts/check-parent-azure.cjs --live
if (!process.argv.includes("--live")) { console.log("Add --live to test configured Azure services using synthetic text. Small API usage charges may apply."); process.exit(0); }
const sentence = "The revised samples are due on Friday. Please confirm the deadline.";
async function main() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const version = process.env.AZURE_OPENAI_API_VERSION;
  console.log("Azure text settings present:", Boolean(endpoint && key && deployment && version));
  if (endpoint && key && deployment && version) {
    const r = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`, { method:"POST", headers:{"Content-Type":"application/json","api-key":key}, body: JSON.stringify({messages:[{role:"system",content:"Return JSON with a single field meaning containing the Chinese meaning of the provided English sentence."},{role:"user",content:sentence}],response_format:{type:"json_object"},max_tokens:100}), signal:AbortSignal.timeout(30000) });
    let valid=false; if(r.ok) { const b=await r.json(); try { valid=typeof JSON.parse(b.choices?.[0]?.message?.content).meaning==='string'; } catch { /* diagnostic only */ } }
    console.log("Azure JSON generation:", r.status, "valid:",valid);
  }
  const speechKey = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION;
  console.log("Azure speech settings present:", Boolean(speechKey && region));
  if (!speechKey || !region) return;
  const tts = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {method:"POST",headers:{"Ocp-Apim-Subscription-Key":speechKey,"Content-Type":"application/ssml+xml","X-Microsoft-OutputFormat":"riff-16khz-16bit-mono-pcm"},body:`<speak version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural">${sentence}</voice></speak>`,signal:AbortSignal.timeout(30000)});
  console.log("English TTS:",tts.status); if(!tts.ok)return;
  const audio=await tts.arrayBuffer();
  const stt=await fetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple`,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":speechKey,"Content-Type":"audio/wav; codecs=audio/pcm; samplerate=16000",Accept:"application/json"},body:audio,signal:AbortSignal.timeout(30000)});
  const b=stt.ok?await stt.json():{}; console.log("English STT:",stt.status,"recognized:",b.RecognitionStatus==='Success');
}
main().catch(error=>{console.error("Connectivity check failed:",error.name);process.exitCode=1;});
