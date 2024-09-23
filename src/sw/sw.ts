import { Mutex } from "async-mutex";
import { Source, SourceType, Finding } from "../shared/types";

let currentTab: chrome.tabs.Tab | null = null;
let storageMutex = new Mutex();

const scanSettings = {
  searchQueryValues: true,
  searchPath: true,
  searchNullUndefined: true,
  clearOnRefresh: true,
  caseInsensitive: true,
  partialMatch: true,
};

function storeFinding(finding: Finding) {
  storageMutex.runExclusive(async () => {
    chrome.storage.local.get("findings", (items) => {
      const findings = items.findings || [];
      findings.push(finding);
      chrome.storage.local.set({ findings });
    });
  });
}

function updateCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      currentTab = tabs[0];
    }
  });
}

chrome.tabs.onActivated.addListener(updateCurrentTab);
chrome.tabs.onUpdated.addListener(updateCurrentTab);

updateCurrentTab();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (currentTab && currentTab.url) {
      if (details.url === currentTab.url) {
        return;
      }
      const sources = urlToSources(currentTab.url);
      const findings = generateFindings(details.url, sources);
      findings.forEach((finding) => storeFinding(finding)); // TODO: store multiple findings at once
    }
  },
  { urls: ["<all_urls>"] },
);

function urlToSources(url: string): Source[] {
  const sources: Source[] = [];
  const u = new URL(url);

  if (scanSettings.searchQueryValues) {
    const query = u.searchParams;
    query.forEach((v) => {
      sources.push({
        type: SourceType.QueryValue,
        url: url,
        value: v,
      });

      const encoded = encodeURIComponent(v);
      if (encoded !== v) {
        sources.push({
          type: SourceType.QueryValueEncoded,
          url: url,
          value: encoded,
        });
      }
    });
  }

  if (scanSettings.searchPath) {
    const pathParts = u.pathname.split("/");
    pathParts.forEach((part) => {
      sources.push({
        type: SourceType.PathValue,
        url: url,
        value: part,
      });

      const encoded = encodeURIComponent(part);
      if (encoded !== part) {
        sources.push({
          type: SourceType.PathValueEncoded,
          url: url,
          value: encoded,
        });
      }
    });
  }

  if (scanSettings.searchNullUndefined) {
    const undefinedValue = "undefined";
    sources.push({
      type: SourceType.UndefinedValue,
      url: url,
      value: undefinedValue,
    });

    const nullValue = "null";
    sources.push({
      type: SourceType.NullValue,
      url: url,
      value: nullValue,
    });
  }

  return sources.filter((source) => source.value.length > 0);
}

function generateFindings(url: string, sources: Source[]): Finding[] {
  const findings: Finding[] = [];
  const pathParts = new URL(url).pathname.split("/");

  sources.forEach((source) => {
    pathParts.forEach((part) => {
      const match = scanSettings.partialMatch
        ? part.includes(source.value)
        : part === source.value;
      if (part.length !== 0 && match) {
        findings.push({
          source,
          target: {
            url,
          },
        });
      }
    });
  });

  return findings;
}
