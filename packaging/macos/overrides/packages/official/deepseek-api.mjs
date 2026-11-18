import {isOfficialDeepSeekEndpoint,deepSeekOpenCodeModelId} from './legacy/cli/deepseek-opencode-config.mjs';
import {fetchModelCatalog} from './model-catalog.mjs';

export async function verifyDeepSeekApi(settings,{fetchImpl=fetch}={}){
  if(settings.provider!=='DeepSeek'||!settings.apiKey||!isOfficialDeepSeekEndpoint(settings.baseUrl))throw Error('请在 DeepSeek 官方 API 配置中保存密钥');
  const catalog=await fetchModelCatalog(settings,settings.apiKey,{fetchImpl});
  const response=await fetchImpl('https://api.deepseek.com/user/balance',{
    headers:{Authorization:'Bearer '+settings.apiKey},redirect:'error',signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){await response.body?.cancel();throw Error('DeepSeek 余额查询失败（HTTP '+response.status+'）');}
  const {is_available:available}=await response.json();
  if(typeof available!=='boolean')throw Error('DeepSeek 没有返回可用余额状态');
  const modelListed=catalog.models.some(m=>m.id===deepSeekOpenCodeModelId(settings.model));
  const code=!available?'DEEPSEEK_INSUFFICIENT_BALANCE':!modelListed?'MODEL_NOT_IN_REMOTE_CATALOG':'';
  return {ok:!code,code,scope:'model-directory-and-balance',credentialVerified:true,balanceAvailable:available,modelListed,paidGenerationTested:false,
    message:!available?'DeepSeek 官方 API 已验证密钥，当前账号余额不足。':!modelListed?'DeepSeek 密钥已验证，官方目录中没有所选模型。':'DeepSeek 密钥、模型目录与可用余额核验通过。'};
}
