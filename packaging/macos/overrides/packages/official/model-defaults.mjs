import {join} from 'node:path';
import {jsonStore,failure} from './store.mjs';
import {MODEL_CHANNELS,profileSupports} from '../ui/model-capabilities.js';

// Manual card defaults have their own revision and never modify connections or
// conversation settings. Retain a frozen fallback for cards predating snapshots.
export function createModelDefaults({dataRoot,models,legacySettings}){
 const store=jsonStore(join(dataRoot,'machine','model-defaults.json'),{revision:0});
 let initializing;
 async function read(catalog){
  let state=await store.read();
  if(!state.defaultProfiles){
   initializing??=(async()=>{
    const {profiles}=catalog||await models.list(),settings=await legacySettings();
    const values=Object.fromEntries(MODEL_CHANNELS.map(channel=>{
     const prior=profiles.find(p=>p.id===settings[channel+'ProfileId']);
     const selected=prior&&profileSupports(prior,channel)?prior:profiles.find(p=>!p.aliasFor&&p.enabled!==false&&profileSupports(p,channel));
     return [channel,selected?.preserveLegacySettings?selected.id:selected?.aliasFor||selected?.id||''];
    }));
    return store.update(s=>s.defaultProfiles?s:{...s,defaultProfiles:values,legacyDefaultProfiles:values});
   })().finally(()=>{initializing=null;});
   await initializing;state=await store.read();
  }
  return {defaultsRevision:state.revision,defaultProfiles:state.defaultProfiles,legacyDefaultProfiles:state.legacyDefaultProfiles};
 }
 async function set({channel,profileId,expectedRevision}){
  if(!MODEL_CHANNELS.includes(channel)||typeof profileId!=='string')throw failure('请选择有效的模型类型与配置');
  const catalog=await models.list();await read(catalog);
  const selected=catalog.profiles.find(p=>p.id===profileId),id=selected?.aliasFor||profileId;
  if(profileId&&(!selected||selected.enabled===false||!profileSupports(selected,channel)))throw failure('配置不存在、未启用或不支持此类型');
  await store.update(s=>{if(s.revision!==expectedRevision)throw failure('默认配置已在其他窗口修改，请刷新后重试','SETTINGS_CONFLICT');s.defaultProfiles[channel]=id;s.revision++;return s;});
  return {...catalog,...await read()};
 }
 return {read,set};
}
