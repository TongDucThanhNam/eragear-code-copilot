import { Platform } from "react-native";

const WS_PREFIX_REGEX = /^ws:\/\//;
const WSS_PREFIX_REGEX = /^wss:\/\//;
const HTTP_PREFIX_REGEX = /^http:\/\//;
const HTTPS_PREFIX_REGEX = /^https:\/\//;

const LOCAL_DEV_URL_REGEX = /localhost|127\.0\.0\.1|10\.0\.2\.2/;

export function getDefaultServerUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `http://${host}:3000`;
}

export function isLocalDevUrl(url: string): boolean {
  return LOCAL_DEV_URL_REGEX.test(url);
}

export function toWsUrl(url: string): string {
  if (WS_PREFIX_REGEX.test(url) || WSS_PREFIX_REGEX.test(url)) {
    return url;
  }
  if (HTTP_PREFIX_REGEX.test(url) || HTTPS_PREFIX_REGEX.test(url)) {
    return url
      .replace(HTTP_PREFIX_REGEX, "ws://")
      .replace(HTTPS_PREFIX_REGEX, "wss://");
  }
  return `ws://${url}`;
}

export function toHttpUrl(url: string): string {
  if (HTTP_PREFIX_REGEX.test(url) || HTTPS_PREFIX_REGEX.test(url)) {
    return url;
  }
  if (WS_PREFIX_REGEX.test(url) || WSS_PREFIX_REGEX.test(url)) {
    return url
      .replace(WS_PREFIX_REGEX, "http://")
      .replace(WSS_PREFIX_REGEX, "https://");
  }
  return `http://${url}`;
}
