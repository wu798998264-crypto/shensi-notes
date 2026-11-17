let defaults={},legacyDefaults={};
export function updateCardModelDefaults(value){defaults={...value.defaultProfiles};legacyDefaults={...value.legacyDefaultProfiles};}
export function snapshotCardModelDefaults(node,values=defaults){
 if(!Object.hasOwn(node,'coreDefaultProfiles'))node.coreDefaultProfiles={...values};
 return node;
}
export function snapshotCopiedCardDefaults(node){return snapshotCardModelDefaults(node,legacyDefaults);}
export function cardModelProfile(doc,node,channel){
 const draft=doc?.canvas?.coreGenerationDrafts?.[node.id]??doc?.coreLegacyGenerationDrafts?.[node.id];
 const selected=draft?.channels?.[channel]||(!draft?.channel||draft.channel===channel?draft:null);
 return selected?.profileId??node.coreDefaultProfiles?.[channel]??legacyDefaults[channel]??'';
}
