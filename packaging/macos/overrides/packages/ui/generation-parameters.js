import {profileForChannel} from './model-capabilities.js';
import {canonicalCanvasModel} from './dreamina-canvas-models.js';
import {isGptImage26,isGptImageVariant} from './gpt-image-options.js';
import {videoTimingForCapabilities} from './video-timing.js';
import {textModelSelection} from './text-model-selection.js';
// Prompt-level requests, not a promise that the website exposes these presets.
export const DOUBAO_ASPECT_RATIOS=Object.freeze(['auto','16:9','9:16','1:1','4:3','3:4','21:9','3:2','2:3']);
const list = (values, fallback) => Array.isArray(values) && values.length ? values : fallback;
const choice = (value, choices, fallback) => choices.find(item => String(item) === String(value)) ?? choices.find(item => String(item) === String(fallback)) ?? choices[0];

export function defaultVideoResolution(caps = {}, mode = '') {
  const resolutions = list(caps.resolutionsByMode?.[mode], list(caps.resolutions, ['720p']));
  return choice(undefined, resolutions, '720p');
}

// The original model presets are authoritative, including on the first render.
export function generationParameters(channel, profile = {}, saved = {}, {resetModel=false,references=[]} = {}) {
  if(profile.channelProfiles?.[channel])profile=profileForChannel(profile,channel);
  if(channel==='text'){
    const values={...saved},selection=textModelSelection(profile,resetModel?{}:saved),{models,model,reasoningLevels:reasoning,speedModes:speeds,reasoningEffort,speedMode}=selection;
    Object.assign(values,{model,reasoningEffort,speedMode});
    return {values,ratios:[],textModels:models,reasoningLevels:reasoning,speedModes:speeds};
  }
  const values = {...saved}, models=profile.mediaModels?.[channel]||[], raw=(!resetModel&&saved.model)||profile.capabilityModels?.[channel]||profile.model||'', requested=profile.dreaminaCanvasMode==='canvas'?canonicalCanvasModel(raw):raw, selected=requested?models.find(item=>item.slug===requested):models[0];
  // Opening an authored draft must not silently substitute another model.
  const missingModel=profile.adapter!=='browser'&&Array.isArray(profile.mediaModels?.[channel])&&requested&&!selected;
  values.model=requested||selected?.slug||'';
  const caps = selected?.capabilities || (missingModel?{}:profile.capabilities) || {};
  const unavailableReason=missingModel?'当前连接的可用目录未返回原型号 '+requested+'，请手动选择可用模型；原草稿型号已保留。':caps.generationUnavailableReason||'';
  if(channel==='audio'&&profile.dreaminaCanvasMode==='canvas'){
    const mode=caps.audioMode;
    for(const key of ['format','language','sampleRate','speed','tone','customTone','aspectRatio','resolution','quality','generationMode'])delete values[key];
    values.audioType=mode==='tts'?'speech':mode;
    values.durationSeconds=resetModel||saved.durationSeconds===undefined?30:Number(saved.durationSeconds);
    values.voiceId=resetModel?'':saved.voiceId||profile.voice||'';
    return {values,ratios:[],canvasAudio:true,audioMode:mode,voices:caps.voices||[],durationMin:caps.durationMin,durationMax:caps.durationMax,durationStep:caps.durationStep,promptMaxLength:caps.promptMaxLength,unavailableReason};
  }
  const ratios = ['auto', ...new Set(list(caps.aspectRatios, ['16:9', '9:16', '1:1', '4:3', '3:4']))];
  values.aspectRatio = choice(values.aspectRatio, ratios, profile.aspectRatio || '16:9');
  if (channel === 'image') {
    const unlimitedGeneration=false;
    values.unlimitedGeneration=!resetModel&&(saved.unlimitedGeneration===true||saved.unlimitedGeneration==='true');
    const imageCounts=list(caps.imageCounts,[1,2,3,4]);
    values.imageCount=values.unlimitedGeneration?1:choice(values.imageCount,imageCounts,1);
    const qualityOptions = list(caps.qualityOptions, []), resolutions = unavailableReason?[]:list(caps.outputResolutions, list(caps.resolutions, ['standard', 'high']));
    const standard2k=isGptImage26(values.model)||isGptImageVariant(values.model)||/^(gpt-image-2\.5|lib-image-2\.[56]-[sfa])$/i.test(values.model),fresh=resetModel||!Object.hasOwn(saved,'quality')&&!Object.hasOwn(saved,'resolution');
    values.quality = qualityOptions.length ? choice(fresh?undefined:values.quality, qualityOptions, standard2k?'standard':'high') : '';
    values.resolution = resolutions.length?choice(fresh?undefined:values.resolution, resolutions, standard2k?'2k':'1k'):'';
    values.background = caps.backgrounds?.length ? choice(values.background, caps.backgrounds, 'auto') : '';
    return {values, ratios, qualityOptions, resolutions,imageCounts, backgrounds: caps.backgrounds || [],unlimitedGeneration,unavailableReason:values.unlimitedGeneration?'无限生成已取消。请重新选择模型或数量，确认按普通生成计费后再提交；原草稿未发送。':unavailableReason};
  }
  if (channel === 'video') {
    const libTv=profile.provider==='LibTV'&&profile.adapter==='cli';
    values.libTvOperation=libTv&&['hd','final'].includes(values.libTvOperation)?values.libTvOperation:'';
    values.videoCount=choice(values.videoCount,[1,2,3,4],1);values.generateAudio=values.generateAudio!==false&&values.generateAudio!=='false';
    const modes = list(caps.generationModes, ['smart_params', 'first_last_frame', 'smart_multiframe']);
    values.generationMode = choice(profile.dreaminaCanvasMode==='canvas'&&['smart_params','smart_multiframe'].includes(values.generationMode)?'auto':values.generationMode, modes, 'smart_params');
    const resolutions = list(caps.resolutionsByMode?.[values.generationMode],list(caps.resolutions, ['480p', '720p', '1080p', '4k']));
    // New tasks prefer 720p; authored drafts/manual choices remain unchanged.
    // Models without 720p retain their supported fallback, never a fake option.
    values.resolution = choice(values.resolution, resolutions, defaultVideoResolution(caps, values.generationMode));
    const timing=videoTimingForCapabilities(caps,values,references);
    const derived = timing.durationDerivedFromReference;
    // Keep the authored duration when opening a draft. The picker can then
    // show a conflicting supported range without overwriting the storyboard.
    const draftDuration = Number(saved.durationSeconds);
    const preserveRequested=!resetModel&&Number.isFinite(draftDuration)&&draftDuration>0&&values.generationMode!=='long_video';
    const durations = derived ? [] : list(values.generationMode === 'long_video' ? caps.longVideoDurationSeconds : timing.durationSeconds, preserveRequested&&!timing.enforced ? [draftDuration] : [5]);
    values.durationSeconds = derived || values.generationMode === 'smart_multiframe' ? 0 : preserveRequested?draftDuration:choice(values.durationSeconds, durations, durations.includes(4)?4:durations[0]);
    return {values, ratios, modes, unavailableModes:caps.unavailableGenerationModes||[], resolutions, durations, derived,timing,referenceLimits:caps.referenceLimits,unavailableReason};
  }
  return {values, ratios};
}

export function multiframeTransition(saved, fromNode, toNode, index) {
  const sequence = Array.isArray(saved) ? saved : [];
  const old = sequence.find(item => item.fromNode === fromNode && item.toNode === toNode)
    || (sequence.every(item => !item.fromNode && !item.toNode) ? sequence[index] : null);
  const seconds = Number(old?.duration || 4);
  return {index, fromNode, toNode, duration: Math.max(1, Math.min(8, Math.round(seconds * 2) / 2)), prompt: String(old?.prompt || '')};
}
