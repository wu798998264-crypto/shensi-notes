
export function hasCredentialPage(profile){
 if(!profile||['api','tts'].includes(profile.adapter))return false;
 if(profile.externalRef?.pluginId==='thirdparty.doubao')return !!profile.externalRef.accountId;
 return profile.adapter==='cli'&&!!(profile.credentialPageUrl||profile.credentialBinding?.accountId||profile.credentialAccountId||['即梦','LibTV','OpenAI','Anthropic','DeepSeek'].includes(profile.provider));
}
// The external entry is a form choice, never an embedded-browser profile ID.
export const EXTERNAL_BROWSER='__external_browser__';
export function apiKeyAuthorization(fields){
 return fields.adapter==='api'?{...fields,authorizationSource:'api_key',browserProfileId:'',externalBrowserId:'',externalBrowserProfile:'',credentialPageUrl:'',credentialSource:''}:fields;
}
export function modelAuthorizationFields(fields){
 if(fields.adapter==='api')return apiKeyAuthorization(fields);
 const external=fields.browserProfileId===EXTERNAL_BROWSER;
 return {...fields,browserProfileId:external?'':fields.browserProfileId||'',authorizationSource:external?'external_browser':fields.browserProfileId?'browser_profile':'cli',externalBrowserId:external?fields.externalBrowserId||'':'',externalBrowserProfile:external?fields.externalBrowserProfile||'':''};
}
