(() => {
  function status(badge, title) {
    void chrome.runtime.sendMessage({ type: "o3-learning-status", badge, title }).catch(() => {});
  }

  async function dialog(text, ask = false) {
    if (window.top === window) return ask ? window.confirm(text) : window.alert(text);
    const response = await chrome.runtime.sendMessage({ type: "o3-learning-dialog", text, ask });
    if (response?.unavailable || !response) throw new Error("无法在课程外层页面显示提示。");
    return response.accepted;
  }

  if (globalThis.o3LearningRun) {
    globalThis.o3LearningRun.abort();
    status("停止", "已停止自动学习");
    return;
  }

  const controller = new AbortController();
  globalThis.o3LearningRun = controller;
  const { signal } = controller;
  const { isO3Entry, isTalentEntry, learningLayout } = globalThis.o3CourseRoutes;
  const layout = learningLayout(location) ?? "o3";
  const talent = isTalentEntry(location);
  const o3PlayerSelector = ".video-content.video-content-o3.enableTripleScreen";
  const playControl = "button.vjs-play-control.vjs-control.vjs-button";
  const isLearningPage = () => talent ? isTalentEntry(location) :
    learningLayout(location) === layout || (window.top === window && isO3Entry(location));

  function checkRunning() {
    if (!isLearningPage()) controller.abort();
    signal.throwIfAborted();
  }

  async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    checkRunning();
  }

  async function waitFor(read, timeout, message) {
    const deadline = Date.now() + timeout;
    do {
      checkRunning();
      const result = read();
      if (result) return result;
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error(message);
  }

  function getScroller(area) {
    for (let element = area; element && element !== document.body; element = element.parentElement) {
      const overflow = getComputedStyle(element).overflowY;
      if (/^(auto|scroll|overlay)$/.test(overflow) && element.scrollHeight > element.clientHeight) {
        return element;
      }
    }
    return document.scrollingElement;
  }

  async function scrollCourse(area) {
    if (talent) {
      const selector = ".content-document.document-content";
      const documents = area.matches(selector) ? [area] : [...area.querySelectorAll(selector)];
      const innerDocuments = documents.filter((element) => element.closest(".innerContent"));
      const scrollers = (innerDocuments.length ? innerDocuments : documents)
        .filter((element) => element.scrollHeight > element.clientHeight);
      if (scrollers.length) {
        for (const scroller of scrollers) await scrollToBottomAndBack(area, scroller);
        return;
      }
    }

    const scroller = getScroller(area);
    if (scroller) await scrollToBottomAndBack(area, scroller);
  }

  async function scrollToBottomAndBack(area, scroller) {
    const lineHeight = Number.parseFloat(getComputedStyle(scroller).lineHeight) || 24;
    const step = Math.max(1, Math.round(lineHeight));
    for (const direction of [1, -1]) {
      while (area.isConnected && scroller.isConnected) {
        checkRunning();
        const previous = scroller.scrollTop;
        scroller.scrollTo({ top: previous + direction * step, behavior: "instant" });
        if (Math.abs(scroller.scrollTop - previous) < 0.5) break;
        await delay(35);
      }
      if (direction === 1) await delay(1000);
    }
    if (!area.isConnected || !scroller.isConnected) {
      throw new Error("滚动时课程内容发生了变化，请重新启动。");
    }
  }

  async function playVideo(player, index) {
    const label = `第 ${index + 1} 个视频`;
    status("播放", `正在处理${label}，再点一次可停止`);
    const video = await waitFor(() => player.matches("video") ? player : player.querySelector("video"),
      15000, `${label}未加载。`);
    player = video.closest(".video-js") ?? player;
    const finished = () => video.ended || Boolean(player.querySelector(".video-js.vjs-ended")) ||
      player.matches(".vjs-ended");
    if (finished()) return;

    if (video.paused && !player.querySelector(`${playControl}.vjs-playing`)) {
      const pausedButton = player.querySelector(`${playControl}.vjs-paused`);
      const bigButton = player.querySelector(".vjs-big-play-button");
      const visibleBigButton = bigButton?.getClientRects().length ? bigButton : null;
      const button = visibleBigButton ?? pausedButton ?? bigButton;
      if (button) button.click();
      else void video.play().catch(() => {});
    }

    await waitFor(
      () => finished() || !video.paused || player.querySelector(`${playControl}.vjs-playing`),
      12000,
      `${label}未能开始播放。请在页面上手动播放后重新启动扩展。`,
    );

    if (finished()) return;
    const rateOption = [...player.querySelectorAll(".vjs-playback-rate .vjs-menu-item")]
      .find((item) => /^2\s*[x×]$/i.test(item.textContent.trim()));
    if (video.playbackRate !== 2) {
      rateOption?.click();
      if (video.playbackRate !== 2) {
        try {
          video.playbackRate = 2;
        } catch (error) {
          console.warn("无法设置视频为 2 倍速", error);
        }
      }
    }
    status("播放", `正在播放${label}（${video.playbackRate} 倍速），再点一次可停止`);

    let lastTime = video.currentTime;
    let lastProgress = Date.now();
    while (!finished()) {
      if (!video.isConnected || video.error) throw new Error(`${label}播放中断。`);
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
      }
      if (Date.now() - lastProgress > 60000) throw new Error(`${label}超过一分钟没有播放进度。`);
      await delay(250);
    }
  }

  function getChapter() {
    if (talent) {
      const area = document.querySelector(".contentArea");
      if (area) return { middle: area.closest(".col.middle") ?? area.parentElement, area };
    }
    if (layout === "classic") {
      const area = document.querySelector(".course-content .content-overflow");
      return area?.querySelector(".content-coursewares") && { middle: area.parentElement, area, classic: true };
    }
    const middle = document.querySelector(".col.middle");
    const area = middle?.querySelector(".contentArea");
    return area && { middle, area };
  }

  function getNext({ middle, classic }) {
    if (classic) {
      const controls = middle.querySelector(".courseware-button .course-button");
      return { next: controls?.querySelector(".course-next")?.parentElement, last: Boolean(controls) &&
        !controls.querySelector(".course-next") };
    }
    const candidates = talent
      ? [...middle.querySelectorAll(".switch-btn .next"), ...document.querySelectorAll(".switch-btn .next"),
        ...middle.querySelectorAll(".next")]
      : middle.querySelectorAll(".next");
    const next = [...candidates].find((element) => element.getClientRects().length);
    return { next, last: next?.classList.contains("no-drop") };
  }

  function getPlayers(area, classic) {
    const selector = classic ? ".content-video" : talent ? ".video-content" : o3PlayerSelector;
    return [...area.querySelectorAll(selector)].filter((player) => !area.contains(player.parentElement?.closest(selector)));
  }

  function chapterContent(area, classic) {
    const snapshot = area.cloneNode(true);
    for (const player of getPlayers(snapshot, classic)) {
      const media = player.matches("video") ? [player, ...player.querySelectorAll("source")] :
        [...player.querySelectorAll("video, source")];
      player.replaceWith(document.createTextNode(media.map((element) => element.getAttribute("src") ?? "").join(" ")));
    }
    return snapshot.textContent.trim();
  }

  function readProgress(classic) {
    const leftSelector = ".col.left :is(.progress, [role='progressbar'], progress)";
    const indicators = classic ? document.querySelectorAll(".catalag-title button") :
      talent ? [...document.querySelectorAll(".catalog-tree .progress"), ...document.querySelectorAll(leftSelector)] :
        document.querySelectorAll(leftSelector);
    for (const element of indicators) {
      const values = [element.innerText, element.textContent, element.getAttribute("aria-valuetext"),
        element.getAttribute("title"), element.getAttribute("aria-label")];
      for (const value of values) {
        const match = value?.normalize("NFKC").match(/(\d+(?:\.\d+)?)\s*%/);
        if (match && Number(match[1]) <= 100) return { percent: Number(match[1]) };
      }
      const value = element.getAttribute("aria-valuenow") ?? (element.matches("progress")
        ? element.getAttribute("value") : null);
      const max = Number(element.getAttribute("aria-valuemax") ?? element.getAttribute("max") ??
        (element.matches("progress") ? 1 : 100));
      const min = Number(element.getAttribute("aria-valuemin") ?? 0);
      if (value?.trim() && max > min && Number(value) >= min && Number(value) <= max) {
        return { percent: 100 * (Number(value) - min) / (max - min) };
      }
    }
    return { reason: indicators.length ? "找到了进度栏，但无法识别进度数值。" : "没有找到课程进度栏。" };
  }

  async function run() {
    let chapter = await waitFor(getChapter, 15000, !talent && layout === "o3" && window.top === window
      ? "未找到课程内容。请等嵌入的课程页面加载完成，再点击扩展。"
      : "未找到章节内容。请登录并打开具体章节后重试。");
    let progress = readProgress(chapter.classic);
    const deadline = Date.now() + 4000;
    while (progress.percent === undefined && Date.now() < deadline) {
      await delay(100);
      progress = readProgress(chapter.classic);
    }

    const prompt = progress.reason ?? (progress.percent > 90
      ? `已完成 ${Number(progress.percent.toFixed(2))}%。` : "");
    if (prompt) {
      status("确认", "请在页面确认是否继续学习");
      const accepted = await dialog(`${prompt}\n是否继续学习？`, true);
      checkRunning();
      if (!accepted) {
        status("取消", "已取消自动学习");
        return;
      }
    }

    chapter = await waitFor(getChapter, 15000, "找不到课程内容。");
    while (true) {
      const { area, classic } = chapter;
      status("滚动", "正在滚动课程内容，再点一次可停止");
      await scrollCourse(area);
      const players = getPlayers(area, classic);
      for (const [index, player] of players.entries()) {
        await playVideo(player, index);
      }

      checkRunning();
      const { next, last } = getNext(chapter);
      if (last || !next) {
        status(last ? "完成" : "停止", last ? "已到最后一节" : "没有找到下一节");
        await dialog(last ? "课程已学习到最后一节。" : "没有找到“下一节”，自动学习已停止。");
        return;
      }

      const previousUrl = location.href;
      const previousContent = chapterContent(area, classic);
      status("切换", "正在切换到下一节");
      next.click();
      chapter = await waitFor(() => {
        const current = getChapter();
        if (current && (current.area !== area ||
          location.href !== previousUrl || chapterContent(current.area, current.classic) !== previousContent)) {
          return current;
        }
        return null;
      }, 15000, "点击“下一节”后未检测到章节切换，自动学习已停止。");
      await delay(350);
      chapter = await waitFor(getChapter, 15000, "找不到下一节的课程内容。");
    }
  }

  void run().catch(async (error) => {
    if (!signal.aborted) {
      status("停止", error.message);
      await dialog(`O3 自动学习已停止。\n${error.message}`).catch(() => {});
    }
  }).finally(() => {
    delete globalThis.o3LearningRun;
  });
})();
