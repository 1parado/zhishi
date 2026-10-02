/**
 * 读取浏览器当前打开的所有标签页，提取可加入白名单的域名。
 *
 * 只读、不修改任何标签页；读 url 依赖 manifest 的 "tabs" 权限（已声明）。
 * 提取与去重是纯函数（pure.tabDomains），这里只负责取数据与兜底——
 * 权限被撤销或 API 异常时返回空列表，让界面显示空态而不是崩掉。
 */
import { tabDomains } from './pure.js';

/**
 * @returns {Promise<Array<{ domain: string, count: number }>>}
 *   保序去重的域名列表；count 是该域名打开的标签页数量。
 */
export async function listOpenTabs() {
  try {
    return tabDomains(await chrome.tabs.query({}));
  } catch {
    return [];
  }
}
