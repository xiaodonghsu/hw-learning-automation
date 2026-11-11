globalThis.o3CourseRoutes = {
  isO3Entry({ origin, pathname }) {
    return origin === "https://cn.o3community.huawei.com" &&
      /^\/cn\/zh\/learning(?:\/|$)/.test(pathname);
  },

  isTalentEntry({ origin, pathname }) {
    return origin === "https://talent.shixizhi.huawei.com" &&
      /^\/course(?:\/|$)/.test(pathname);
  },

  isHuaweiOutPage({ origin, pathname }) {
    return (origin === "https://e.huawei.com" && /^\/cn\/talent\/outPage\/?$/.test(pathname)) ||
      (origin === "https://r.huaweistatic.com" && /^\/s\/hwtalent\/lst\/outPage(?:\/index\.html|\/)?$/.test(pathname));
  },

  learningLayout({ origin, pathname }) {
    if (origin === "https://talent.shixizhi.huawei.com") {
      if (/^\/course\/[^/]+\/course-learn\/?$/.test(pathname)) return "classic";
      if (/^\/course\/[^/]+\/application-learn(?:\/[^/]+)?\/?$/.test(pathname)) return "application";
    }
    if (origin === "https://o3community.shixizhi.huawei.com" &&
        /^\/course\/[^/]+\/application-learn\/?$/.test(pathname)) return "o3";
    return null;
  },
};
