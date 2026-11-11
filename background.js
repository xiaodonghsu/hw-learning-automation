importScripts("course-routes.js");

const { isO3Entry, isTalentEntry, isHuaweiOutPage, learningLayout } = globalThis.o3CourseRoutes;

function isCourseFrame(frame) {
  if (frame.parentFrameId !== 0 || frame.errorOccurred || !frame.url) return false;
  return Boolean(learningLayout(new URL(frame.url)));
}

async function openEmbeddedTalentCourse(tab) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  const courseFrame = frames?.find(({ frameId, errorOccurred, url }) =>
    frameId > 0 && !errorOccurred && url && isTalentEntry(new URL(url)));
  if (!courseFrame) {
    await setStatus(tab.id, "页面", "未找到时习知课程，请等课程加载完成后再试");
    return;
  }
  await chrome.tabs.create({ url: courseFrame.url, active: true, openerTabId: tab.id, windowId: tab.windowId });
  await setStatus(tab.id, "已打开", "请在新标签页继续学习");
}

function setStatus(tabId, badge, title) {
  return Promise.all([
    chrome.action.setBadgeText({ tabId, text: badge }),
    chrome.action.setTitle({ tabId, title: `O3 自动学习 · ${title}` }),
  ]);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (message?.type === "o3-learning-status") {
    void setStatus(tabId, message.badge, message.title).catch(() => {});
  }
  if (message?.type === "o3-learning-dialog" &&
      sender.frameId > 0 && sender.url && learningLayout(new URL(sender.url))) {
    void chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (text, ask) => ask ? window.confirm(text) : window.alert(text),
      args: [message.text, message.ask],
    }).then(([result]) => reply({ accepted: result?.result === true }))
      .catch(() => reply({ unavailable: true }));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") {
    void Promise.all([
      chrome.action.setBadgeText({ tabId, text: "" }),
      chrome.action.setTitle({ tabId, title: "启动或停止 O3 课程自动学习" }),
    ]).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  try {
    const url = tab.url && new URL(tab.url);
    if (url && isHuaweiOutPage(url)) {
      await openEmbeddedTalentCourse(tab);
      return;
    }
    if (!url || (!isO3Entry(url) && !isTalentEntry(url))) {
      await setStatus(tab.id, "页面", "请先打开华为 O3 或时习知学习页面并进入课程");
      return;
    }
    await setStatus(tab.id, "检查", "正在检查课程页面，再点一次可停止");
    const layout = learningLayout(url);
    const frames = layout ? [] : await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    const courseFrame = frames?.find(isCourseFrame);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [courseFrame?.frameId ?? 0] },
      files: ["course-routes.js", "learning.js"],
    });
  } catch (error) {
    await setStatus(tab.id, "失败", "无法启动，请刷新课程页面后重试").catch(() => {});
    console.error("无法启动 O3 课程自动学习", error);
  }
});
