var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var escapeRe = /[&<>'"]/;
var stringBufferToString = async (buffer, callbacks) => {
  let str = "";
  callbacks ||= [];
  const resolvedBuffer = await Promise.all(buffer);
  for (let i = resolvedBuffer.length - 1;; i--) {
    str += resolvedBuffer[i];
    i--;
    if (i < 0) {
      break;
    }
    let r = resolvedBuffer[i];
    if (typeof r === "object") {
      callbacks.push(...r.callbacks || []);
    }
    const isEscaped = r.isEscaped;
    r = await (typeof r === "object" ? r.toString() : r);
    if (typeof r === "object") {
      callbacks.push(...r.callbacks || []);
    }
    if (r.isEscaped ?? isEscaped) {
      str += r;
    } else {
      const buf = [str];
      escapeToBuffer(r, buf);
      str = buf[0];
    }
  }
  return raw(str, callbacks);
};
var escapeToBuffer = (str, buffer) => {
  const match = str.search(escapeRe);
  if (match === -1) {
    buffer[0] += str;
    return;
  }
  let escape;
  let index;
  let lastIndex = 0;
  for (index = match;index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34:
        escape = "&quot;";
        break;
      case 39:
        escape = "&#39;";
        break;
      case 38:
        escape = "&amp;";
        break;
      case 60:
        escape = "&lt;";
        break;
      case 62:
        escape = "&gt;";
        break;
      default:
        continue;
    }
    buffer[0] += str.substring(lastIndex, index) + escape;
    lastIndex = index + 1;
  }
  buffer[0] += str.substring(lastIndex, index);
};
var resolveCallbackSync = (str) => {
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return str;
  }
  const buffer = [str];
  const context = {};
  callbacks.forEach((c) => c({ phase: HtmlEscapedCallbackPhase.Stringify, buffer, context }));
  return buffer[0];
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/constants.js
var DOM_RENDERER = /* @__PURE__ */ Symbol("RENDERER");
var DOM_ERROR_HANDLER = /* @__PURE__ */ Symbol("ERROR_HANDLER");
var DOM_STASH = /* @__PURE__ */ Symbol("STASH");
var DOM_INTERNAL_TAG = /* @__PURE__ */ Symbol("INTERNAL");
var DOM_MEMO = /* @__PURE__ */ Symbol("MEMO");

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/utils.js
var setInternalTagFlag = (fn) => {
  fn[DOM_INTERNAL_TAG] = true;
  return fn;
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/context.js
var createContextProviderFunction = (values) => ({ value, children }) => {
  if (!children) {
    return;
  }
  const props = {
    children: [
      {
        tag: setInternalTagFlag(() => {
          values.push(value);
        }),
        props: {}
      }
    ]
  };
  if (Array.isArray(children)) {
    props.children.push(...children.flat());
  } else {
    props.children.push(children);
  }
  props.children.push({
    tag: setInternalTagFlag(() => {
      values.pop();
    }),
    props: {}
  });
  const res = { tag: "", props, type: "" };
  res[DOM_ERROR_HANDLER] = (err) => {
    values.pop();
    throw err;
  };
  return res;
};
var createContext = (defaultValue) => {
  const values = [defaultValue];
  const context = createContextProviderFunction(values);
  context.values = values;
  context.Provider = context;
  globalContexts.push(context);
  return context;
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/context.js
var globalContexts = [];
var createContext2 = (defaultValue) => {
  const values = [defaultValue];
  const context = (props) => {
    values.push(props.value);
    let string;
    try {
      string = props.children ? (Array.isArray(props.children) ? new JSXFragmentNode("", {}, props.children) : props.children).toString() : "";
    } finally {
      values.pop();
    }
    if (string instanceof Promise) {
      return string.then((resString) => raw(resString, resString.callbacks));
    } else {
      return raw(string);
    }
  };
  context.values = values;
  context.Provider = context;
  context[DOM_RENDERER] = createContextProviderFunction(values);
  globalContexts.push(context);
  return context;
};
var useContext = (context) => {
  return context.values.at(-1);
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/intrinsic-element/common.js
var deDupeKeyMap = {
  title: [],
  script: ["src"],
  style: ["data-href"],
  link: ["href"],
  meta: ["name", "httpEquiv", "charset", "itemProp"]
};
var domRenderers = {};
var dataPrecedenceAttr = "data-precedence";

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/children.js
var toArray = (children) => Array.isArray(children) ? children : [children];

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/utils.js
var normalizeElementKeyMap = /* @__PURE__ */ new Map([
  ["className", "class"],
  ["htmlFor", "for"],
  ["crossOrigin", "crossorigin"],
  ["httpEquiv", "http-equiv"],
  ["itemProp", "itemprop"],
  ["fetchPriority", "fetchpriority"],
  ["noModule", "nomodule"],
  ["formAction", "formaction"]
]);
var normalizeIntrinsicElementKey = (key) => normalizeElementKeyMap.get(key) || key;
var styleObjectForEach = (style, fn) => {
  for (const [k, v] of Object.entries(style)) {
    const key = k[0] === "-" || !/[A-Z]/.test(k) ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    fn(key, v == null ? null : typeof v === "number" ? !key.match(/^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/) ? `${v}px` : `${v}` : v);
  }
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/base.js
var nameSpaceContext = undefined;
var toSVGAttributeName = (key) => /[A-Z]/.test(key) && key.match(/^(?:al|basel|clip(?:Path|Rule)$|co|do|fill|fl|fo|gl|let|lig|i|marker[EMS]|o|pai|pointe|sh|st[or]|text[^L]|tr|u|ve|w)/) ? key.replace(/([A-Z])/g, "-$1").toLowerCase() : key;
var emptyTags = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
];
var booleanAttributes = [
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "download",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected"
];
var childrenToStringToBuffer = (children, buffer) => {
  for (let i = 0, len = children.length;i < len; i++) {
    const child = children[i];
    if (typeof child === "string") {
      escapeToBuffer(child, buffer);
    } else if (typeof child === "boolean" || child === null || child === undefined) {
      continue;
    } else if (child instanceof JSXNode) {
      child.toStringToBuffer(buffer);
    } else if (typeof child === "number" || child.isEscaped) {
      buffer[0] += child;
    } else if (child instanceof Promise) {
      buffer.unshift("", child);
    } else {
      childrenToStringToBuffer(child, buffer);
    }
  }
};
var JSXNode = class {
  tag;
  props;
  key;
  children;
  isEscaped = true;
  localContexts;
  constructor(tag, props, children) {
    this.tag = tag;
    this.props = props;
    this.children = children;
  }
  get type() {
    return this.tag;
  }
  get ref() {
    return this.props.ref || null;
  }
  toString() {
    const buffer = [""];
    this.localContexts?.forEach(([context, value]) => {
      context.values.push(value);
    });
    try {
      this.toStringToBuffer(buffer);
    } finally {
      this.localContexts?.forEach(([context]) => {
        context.values.pop();
      });
    }
    return buffer.length === 1 ? "callbacks" in buffer ? resolveCallbackSync(raw(buffer[0], buffer.callbacks)).toString() : buffer[0] : stringBufferToString(buffer, buffer.callbacks);
  }
  toStringToBuffer(buffer) {
    const tag = this.tag;
    const props = this.props;
    let { children } = this;
    buffer[0] += `<${tag}`;
    const normalizeKey = nameSpaceContext && useContext(nameSpaceContext) === "svg" ? (key) => toSVGAttributeName(normalizeIntrinsicElementKey(key)) : (key) => normalizeIntrinsicElementKey(key);
    for (let [key, v] of Object.entries(props)) {
      key = normalizeKey(key);
      if (key === "children") {} else if (key === "style" && typeof v === "object") {
        let styleStr = "";
        styleObjectForEach(v, (property, value) => {
          if (value != null) {
            styleStr += `${styleStr ? ";" : ""}${property}:${value}`;
          }
        });
        buffer[0] += ' style="';
        escapeToBuffer(styleStr, buffer);
        buffer[0] += '"';
      } else if (typeof v === "string") {
        buffer[0] += ` ${key}="`;
        escapeToBuffer(v, buffer);
        buffer[0] += '"';
      } else if (v === null || v === undefined) {} else if (typeof v === "number" || v.isEscaped) {
        buffer[0] += ` ${key}="${v}"`;
      } else if (typeof v === "boolean" && booleanAttributes.includes(key)) {
        if (v) {
          buffer[0] += ` ${key}=""`;
        }
      } else if (key === "dangerouslySetInnerHTML") {
        if (children.length > 0) {
          throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
        }
        children = [raw(v.__html)];
      } else if (v instanceof Promise) {
        buffer[0] += ` ${key}="`;
        buffer.unshift('"', v);
      } else if (typeof v === "function") {
        if (!key.startsWith("on") && key !== "ref") {
          throw new Error(`Invalid prop '${key}' of type 'function' supplied to '${tag}'.`);
        }
      } else {
        buffer[0] += ` ${key}="`;
        escapeToBuffer(v.toString(), buffer);
        buffer[0] += '"';
      }
    }
    if (emptyTags.includes(tag) && children.length === 0) {
      buffer[0] += "/>";
      return;
    }
    buffer[0] += ">";
    childrenToStringToBuffer(children, buffer);
    buffer[0] += `</${tag}>`;
  }
};
var JSXFragmentNode = class extends JSXNode {
  toStringToBuffer(buffer) {
    childrenToStringToBuffer(this.children, buffer);
  }
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/intrinsic-element/components.js
var exports_components2 = {};
__export(exports_components2, {
  title: () => title,
  style: () => style,
  script: () => script,
  meta: () => meta,
  link: () => link,
  input: () => input,
  form: () => form,
  composeRef: () => composeRef,
  clearCache: () => clearCache,
  button: () => button
});

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/render.js
var HONO_PORTAL_ELEMENT = "_hp";
var eventAliasMap = {
  Change: "Input",
  DoubleClick: "DblClick"
};
var nameSpaceMap = {
  svg: "2000/svg",
  math: "1998/Math/MathML"
};
var buildDataStack = [];
var refCleanupMap = /* @__PURE__ */ new WeakMap;
var nameSpaceContext2 = undefined;
var getNameSpaceContext2 = () => nameSpaceContext2;
var isNodeString = (node) => ("t" in node);
var eventCache = {
  onClick: ["click", false]
};
var getEventSpec = (key) => {
  if (!key.startsWith("on")) {
    return;
  }
  if (eventCache[key]) {
    return eventCache[key];
  }
  const match = key.match(/^on([A-Z][a-zA-Z]+?(?:PointerCapture)?)(Capture)?$/);
  if (match) {
    const [, eventName, capture] = match;
    return eventCache[key] = [(eventAliasMap[eventName] || eventName).toLowerCase(), !!capture];
  }
  return;
};
var toAttributeName = (element, key) => nameSpaceContext2 && element instanceof SVGElement && /[A-Z]/.test(key) && ((key in element.style) || key.match(/^(?:o|pai|str|u|ve)/)) ? key.replace(/([A-Z])/g, "-$1").toLowerCase() : key;
var applyProps = (container, attributes, oldAttributes) => {
  attributes ||= {};
  for (let key in attributes) {
    const value = attributes[key];
    if (key !== "children" && (!oldAttributes || oldAttributes[key] !== value)) {
      key = normalizeIntrinsicElementKey(key);
      const eventSpec = getEventSpec(key);
      if (eventSpec) {
        if (oldAttributes?.[key] !== value) {
          if (oldAttributes) {
            container.removeEventListener(eventSpec[0], oldAttributes[key], eventSpec[1]);
          }
          if (value != null) {
            if (typeof value !== "function") {
              throw new Error(`Event handler for "${key}" is not a function`);
            }
            container.addEventListener(eventSpec[0], value, eventSpec[1]);
          }
        }
      } else if (key === "dangerouslySetInnerHTML" && value) {
        container.innerHTML = value.__html;
      } else if (key === "ref") {
        let cleanup;
        if (typeof value === "function") {
          cleanup = value(container) || (() => value(null));
        } else if (value && "current" in value) {
          value.current = container;
          cleanup = () => value.current = null;
        }
        refCleanupMap.set(container, cleanup);
      } else if (key === "style") {
        const style = container.style;
        if (typeof value === "string") {
          style.cssText = value;
        } else {
          style.cssText = "";
          if (value != null) {
            styleObjectForEach(value, style.setProperty.bind(style));
          }
        }
      } else {
        if (key === "value") {
          const nodeName = container.nodeName;
          if (nodeName === "INPUT" || nodeName === "TEXTAREA" || nodeName === "SELECT") {
            container.value = value === null || value === undefined || value === false ? null : value;
            if (nodeName === "TEXTAREA") {
              container.textContent = value;
              continue;
            } else if (nodeName === "SELECT") {
              if (container.selectedIndex === -1) {
                container.selectedIndex = 0;
              }
              continue;
            }
          }
        } else if (key === "checked" && container.nodeName === "INPUT" || key === "selected" && container.nodeName === "OPTION") {
          container[key] = value;
        }
        const k = toAttributeName(container, key);
        if (value === null || value === undefined || value === false) {
          container.removeAttribute(k);
        } else if (value === true) {
          container.setAttribute(k, "");
        } else if (typeof value === "string" || typeof value === "number") {
          container.setAttribute(k, value);
        } else {
          container.setAttribute(k, value.toString());
        }
      }
    }
  }
  if (oldAttributes) {
    for (let key in oldAttributes) {
      const value = oldAttributes[key];
      if (key !== "children" && !(key in attributes)) {
        key = normalizeIntrinsicElementKey(key);
        const eventSpec = getEventSpec(key);
        if (eventSpec) {
          container.removeEventListener(eventSpec[0], value, eventSpec[1]);
        } else if (key === "ref") {
          refCleanupMap.get(container)?.();
        } else {
          container.removeAttribute(toAttributeName(container, key));
        }
      }
    }
  }
};
var invokeTag = (context, node) => {
  node[DOM_STASH][0] = 0;
  buildDataStack.push([context, node]);
  const func = node.tag[DOM_RENDERER] || node.tag;
  const props = func.defaultProps ? {
    ...func.defaultProps,
    ...node.props
  } : node.props;
  try {
    return [func.call(null, props)];
  } finally {
    buildDataStack.pop();
  }
};
var getNextChildren = (node, container, nextChildren, childrenToRemove, callbacks) => {
  if (node.vR?.length) {
    childrenToRemove.push(...node.vR);
    delete node.vR;
  }
  if (typeof node.tag === "function") {
    node[DOM_STASH][1][STASH_EFFECT]?.forEach((data) => callbacks.push(data));
  }
  node.vC.forEach((child) => {
    if (isNodeString(child)) {
      nextChildren.push(child);
    } else {
      if (typeof child.tag === "function" || child.tag === "") {
        child.c = container;
        const currentNextChildrenIndex = nextChildren.length;
        getNextChildren(child, container, nextChildren, childrenToRemove, callbacks);
        if (child.s) {
          for (let i = currentNextChildrenIndex;i < nextChildren.length; i++) {
            nextChildren[i].s = true;
          }
          child.s = false;
        }
      } else {
        nextChildren.push(child);
        if (child.vR?.length) {
          childrenToRemove.push(...child.vR);
          delete child.vR;
        }
      }
    }
  });
};
var findInsertBefore = (node) => {
  for (;; node = node.tag === HONO_PORTAL_ELEMENT || !node.vC || !node.pP ? node.nN : node.vC[0]) {
    if (!node) {
      return null;
    }
    if (node.tag !== HONO_PORTAL_ELEMENT && node.e) {
      return node.e;
    }
  }
};
var removeNode = (node) => {
  if (!isNodeString(node)) {
    node[DOM_STASH]?.[1][STASH_EFFECT]?.forEach((data) => data[2]?.());
    refCleanupMap.get(node.e)?.();
    if (node.p === 2) {
      node.vC?.forEach((n) => n.p = 2);
    }
    node.vC?.forEach(removeNode);
  }
  if (!node.p) {
    node.e?.remove();
    delete node.e;
  }
  if (typeof node.tag === "function") {
    updateMap.delete(node);
    fallbackUpdateFnArrayMap.delete(node);
    delete node[DOM_STASH][3];
    node.a = true;
  }
};
var apply = (node, container, isNew) => {
  node.c = container;
  applyNodeObject(node, container, isNew);
};
var findChildNodeIndex = (childNodes, child) => {
  if (!child) {
    return;
  }
  for (let i = 0, len = childNodes.length;i < len; i++) {
    if (childNodes[i] === child) {
      return i;
    }
  }
  return;
};
var cancelBuild = /* @__PURE__ */ Symbol();
var applyNodeObject = (node, container, isNew) => {
  const next = [];
  const remove = [];
  const callbacks = [];
  getNextChildren(node, container, next, remove, callbacks);
  remove.forEach(removeNode);
  const childNodes = isNew ? undefined : container.childNodes;
  let offset;
  let insertBeforeNode = null;
  if (isNew) {
    offset = -1;
  } else if (!childNodes.length) {
    offset = 0;
  } else {
    const offsetByNextNode = findChildNodeIndex(childNodes, findInsertBefore(node.nN));
    if (offsetByNextNode !== undefined) {
      insertBeforeNode = childNodes[offsetByNextNode];
      offset = offsetByNextNode;
    } else {
      offset = findChildNodeIndex(childNodes, next.find((n) => n.tag !== HONO_PORTAL_ELEMENT && n.e)?.e) ?? -1;
    }
    if (offset === -1) {
      isNew = true;
    }
  }
  for (let i = 0, len = next.length;i < len; i++, offset++) {
    const child = next[i];
    let el;
    if (child.s && child.e) {
      el = child.e;
      child.s = false;
    } else {
      const isNewLocal = isNew || !child.e;
      if (isNodeString(child)) {
        if (child.e && child.d) {
          child.e.textContent = child.t;
        }
        child.d = false;
        el = child.e ||= document.createTextNode(child.t);
      } else {
        el = child.e ||= child.n ? document.createElementNS(child.n, child.tag) : document.createElement(child.tag);
        applyProps(el, child.props, child.pP);
        applyNodeObject(child, el, isNewLocal);
      }
    }
    if (child.tag === HONO_PORTAL_ELEMENT) {
      offset--;
    } else if (isNew) {
      if (!el.parentNode) {
        container.appendChild(el);
      }
    } else if (childNodes[offset] !== el && childNodes[offset - 1] !== el) {
      if (childNodes[offset + 1] === el) {
        container.appendChild(childNodes[offset]);
      } else {
        container.insertBefore(el, insertBeforeNode || childNodes[offset] || null);
      }
    }
  }
  if (node.pP) {
    delete node.pP;
  }
  if (callbacks.length) {
    const useLayoutEffectCbs = [];
    const useEffectCbs = [];
    callbacks.forEach(([, useLayoutEffectCb, , useEffectCb, useInsertionEffectCb]) => {
      if (useLayoutEffectCb) {
        useLayoutEffectCbs.push(useLayoutEffectCb);
      }
      if (useEffectCb) {
        useEffectCbs.push(useEffectCb);
      }
      useInsertionEffectCb?.();
    });
    useLayoutEffectCbs.forEach((cb) => cb());
    if (useEffectCbs.length) {
      requestAnimationFrame(() => {
        useEffectCbs.forEach((cb) => cb());
      });
    }
  }
};
var isSameContext = (oldContexts, newContexts) => !!(oldContexts && oldContexts.length === newContexts.length && oldContexts.every((ctx, i) => ctx[1] === newContexts[i][1]));
var fallbackUpdateFnArrayMap = /* @__PURE__ */ new WeakMap;
var build = (context, node, children) => {
  const buildWithPreviousChildren = !children && node.pC;
  if (children) {
    node.pC ||= node.vC;
  }
  let foundErrorHandler;
  try {
    children ||= typeof node.tag == "function" ? invokeTag(context, node) : toArray(node.props.children);
    if (children[0]?.tag === "" && children[0][DOM_ERROR_HANDLER]) {
      foundErrorHandler = children[0][DOM_ERROR_HANDLER];
      context[5].push([context, foundErrorHandler, node]);
    }
    const oldVChildren = buildWithPreviousChildren ? [...node.pC] : node.vC ? [...node.vC] : undefined;
    const vChildren = [];
    let prevNode;
    for (let i = 0;i < children.length; i++) {
      if (Array.isArray(children[i])) {
        children.splice(i, 1, ...children[i].flat());
      }
      let child = buildNode(children[i]);
      if (child) {
        if (typeof child.tag === "function" && !child.tag[DOM_INTERNAL_TAG]) {
          if (globalContexts.length > 0) {
            child[DOM_STASH][2] = globalContexts.map((c) => [c, c.values.at(-1)]);
          }
          if (context[5]?.length) {
            child[DOM_STASH][3] = context[5].at(-1);
          }
        }
        let oldChild;
        if (oldVChildren && oldVChildren.length) {
          const i2 = oldVChildren.findIndex(isNodeString(child) ? (c) => isNodeString(c) : child.key !== undefined ? (c) => c.key === child.key && c.tag === child.tag : (c) => c.tag === child.tag);
          if (i2 !== -1) {
            oldChild = oldVChildren[i2];
            oldVChildren.splice(i2, 1);
          }
        }
        if (oldChild) {
          if (isNodeString(child)) {
            if (oldChild.t !== child.t) {
              oldChild.t = child.t;
              oldChild.d = true;
            }
            child = oldChild;
          } else {
            const pP = oldChild.pP = oldChild.props;
            oldChild.props = child.props;
            oldChild.f ||= child.f || node.f;
            if (typeof child.tag === "function") {
              const oldContexts = oldChild[DOM_STASH][2];
              oldChild[DOM_STASH][2] = child[DOM_STASH][2] || [];
              oldChild[DOM_STASH][3] = child[DOM_STASH][3];
              if (!oldChild.f && ((oldChild.o || oldChild) === child.o || oldChild.tag[DOM_MEMO]?.(pP, oldChild.props)) && isSameContext(oldContexts, oldChild[DOM_STASH][2])) {
                oldChild.s = true;
              }
            }
            child = oldChild;
          }
        } else if (!isNodeString(child) && nameSpaceContext2) {
          const ns = useContext(nameSpaceContext2);
          if (ns) {
            child.n = ns;
          }
        }
        if (!isNodeString(child) && !child.s) {
          build(context, child);
          delete child.f;
        }
        vChildren.push(child);
        if (prevNode && !prevNode.s && !child.s) {
          for (let p = prevNode;p && !isNodeString(p); p = p.vC?.at(-1)) {
            p.nN = child;
          }
        }
        prevNode = child;
      }
    }
    node.vR = buildWithPreviousChildren ? [...node.vC, ...oldVChildren || []] : oldVChildren || [];
    node.vC = vChildren;
    if (buildWithPreviousChildren) {
      delete node.pC;
    }
  } catch (e) {
    node.f = true;
    if (e === cancelBuild) {
      if (foundErrorHandler) {
        return;
      } else {
        throw e;
      }
    }
    const [errorHandlerContext, errorHandler, errorHandlerNode] = node[DOM_STASH]?.[3] || [];
    if (errorHandler) {
      const fallbackUpdateFn = () => update([0, false, context[2]], errorHandlerNode);
      const fallbackUpdateFnArray = fallbackUpdateFnArrayMap.get(errorHandlerNode) || [];
      fallbackUpdateFnArray.push(fallbackUpdateFn);
      fallbackUpdateFnArrayMap.set(errorHandlerNode, fallbackUpdateFnArray);
      const fallback = errorHandler(e, () => {
        const fnArray = fallbackUpdateFnArrayMap.get(errorHandlerNode);
        if (fnArray) {
          const i = fnArray.indexOf(fallbackUpdateFn);
          if (i !== -1) {
            fnArray.splice(i, 1);
            return fallbackUpdateFn();
          }
        }
      });
      if (fallback) {
        if (context[0] === 1) {
          context[1] = true;
        } else {
          build(context, errorHandlerNode, [fallback]);
          if ((errorHandler.length === 1 || context !== errorHandlerContext) && errorHandlerNode.c) {
            apply(errorHandlerNode, errorHandlerNode.c, false);
            return;
          }
        }
        throw cancelBuild;
      }
    }
    throw e;
  } finally {
    if (foundErrorHandler) {
      context[5].pop();
    }
  }
};
var buildNode = (node) => {
  if (node === undefined || node === null || typeof node === "boolean") {
    return;
  } else if (typeof node === "string" || typeof node === "number") {
    return { t: node.toString(), d: true };
  } else {
    if ("vR" in node) {
      node = {
        tag: node.tag,
        props: node.props,
        key: node.key,
        f: node.f,
        type: node.tag,
        ref: node.props.ref,
        o: node.o || node
      };
    }
    if (typeof node.tag === "function") {
      node[DOM_STASH] = [0, []];
    } else {
      const ns = nameSpaceMap[node.tag];
      if (ns) {
        nameSpaceContext2 ||= createContext("");
        node.props.children = [
          {
            tag: nameSpaceContext2,
            props: {
              value: node.n = `http://www.w3.org/${ns}`,
              children: node.props.children
            }
          }
        ];
      }
    }
    return node;
  }
};
var replaceContainer = (node, from, to) => {
  if (node.c === from) {
    node.c = to;
    node.vC.forEach((child) => replaceContainer(child, from, to));
  }
};
var updateSync = (context, node) => {
  node[DOM_STASH][2]?.forEach(([c, v]) => {
    c.values.push(v);
  });
  try {
    build(context, node, undefined);
  } catch {
    return;
  }
  if (node.a) {
    delete node.a;
    return;
  }
  node[DOM_STASH][2]?.forEach(([c]) => {
    c.values.pop();
  });
  if (context[0] !== 1 || !context[1]) {
    apply(node, node.c, false);
  }
};
var updateMap = /* @__PURE__ */ new WeakMap;
var currentUpdateSets = [];
var update = async (context, node) => {
  context[5] ||= [];
  const existing = updateMap.get(node);
  if (existing) {
    existing[0](undefined);
  }
  let resolve;
  const promise = new Promise((r) => resolve = r);
  updateMap.set(node, [
    resolve,
    () => {
      if (context[2]) {
        context[2](context, node, (context2) => {
          updateSync(context2, node);
        }).then(() => resolve(node));
      } else {
        updateSync(context, node);
        resolve(node);
      }
    }
  ]);
  if (currentUpdateSets.length) {
    currentUpdateSets.at(-1).add(node);
  } else {
    await Promise.resolve();
    const latest = updateMap.get(node);
    if (latest) {
      updateMap.delete(node);
      latest[1]();
    }
  }
  return promise;
};
var renderNode = (node, container) => {
  const context = [];
  context[5] = [];
  context[4] = true;
  build(context, node, undefined);
  context[4] = false;
  const fragment = document.createDocumentFragment();
  apply(node, fragment, true);
  replaceContainer(node, fragment, container);
  container.replaceChildren(fragment);
};
var render = (jsxNode, container) => {
  renderNode(buildNode({ tag: "", props: { children: jsxNode } }), container);
};
var createPortal = (children, container, key) => ({
  tag: HONO_PORTAL_ELEMENT,
  props: {
    children
  },
  key,
  e: container,
  p: 1
});

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/hooks/index.js
var STASH_SATE = 0;
var STASH_EFFECT = 1;
var STASH_CALLBACK = 2;
var STASH_MEMO = 3;
var resolvedPromiseValueMap = /* @__PURE__ */ new WeakMap;
var isDepsChanged = (prevDeps, deps) => !prevDeps || !deps || prevDeps.length !== deps.length || deps.some((dep, i) => dep !== prevDeps[i]);
var updateHook = undefined;
var pendingStack = [];
var useState = (initialState) => {
  const resolveInitialState = () => typeof initialState === "function" ? initialState() : initialState;
  const buildData = buildDataStack.at(-1);
  if (!buildData) {
    return [resolveInitialState(), () => {}];
  }
  const [, node] = buildData;
  const stateArray = node[DOM_STASH][1][STASH_SATE] ||= [];
  const hookIndex = node[DOM_STASH][0]++;
  return stateArray[hookIndex] ||= [
    resolveInitialState(),
    (newState) => {
      const localUpdateHook = updateHook;
      const stateData = stateArray[hookIndex];
      if (typeof newState === "function") {
        newState = newState(stateData[0]);
      }
      if (!Object.is(newState, stateData[0])) {
        stateData[0] = newState;
        if (pendingStack.length) {
          const [pendingType, pendingPromise] = pendingStack.at(-1);
          Promise.all([
            pendingType === 3 ? node : update([pendingType, false, localUpdateHook], node),
            pendingPromise
          ]).then(([node2]) => {
            if (!node2 || !(pendingType === 2 || pendingType === 3)) {
              return;
            }
            const lastVC = node2.vC;
            const addUpdateTask = () => {
              setTimeout(() => {
                if (lastVC !== node2.vC) {
                  return;
                }
                update([pendingType === 3 ? 1 : 0, false, localUpdateHook], node2);
              });
            };
            requestAnimationFrame(addUpdateTask);
          });
        } else {
          update([0, false, localUpdateHook], node);
        }
      }
    }
  ];
};
var useEffectCommon = (index, effect, deps) => {
  const buildData = buildDataStack.at(-1);
  if (!buildData) {
    return;
  }
  const [, node] = buildData;
  const effectDepsArray = node[DOM_STASH][1][STASH_EFFECT] ||= [];
  const hookIndex = node[DOM_STASH][0]++;
  const [prevDeps, , prevCleanup] = effectDepsArray[hookIndex] ||= [];
  if (isDepsChanged(prevDeps, deps)) {
    if (prevCleanup) {
      prevCleanup();
    }
    const runner = () => {
      data[index] = undefined;
      data[2] = effect();
    };
    const data = [deps, undefined, undefined, undefined, undefined];
    data[index] = runner;
    effectDepsArray[hookIndex] = data;
  }
};
var useEffect = (effect, deps) => useEffectCommon(3, effect, deps);
var useCallback = (callback, deps) => {
  const buildData = buildDataStack.at(-1);
  if (!buildData) {
    return callback;
  }
  const [, node] = buildData;
  const callbackArray = node[DOM_STASH][1][STASH_CALLBACK] ||= [];
  const hookIndex = node[DOM_STASH][0]++;
  const prevDeps = callbackArray[hookIndex];
  if (isDepsChanged(prevDeps?.[1], deps)) {
    callbackArray[hookIndex] = [callback, deps];
  } else {
    callback = callbackArray[hookIndex][0];
  }
  return callback;
};
var use = (promise) => {
  const cachedRes = resolvedPromiseValueMap.get(promise);
  if (cachedRes) {
    if (cachedRes.length === 2) {
      throw cachedRes[1];
    }
    return cachedRes[0];
  }
  promise.then((res) => resolvedPromiseValueMap.set(promise, [res]), (e) => resolvedPromiseValueMap.set(promise, [undefined, e]));
  throw promise;
};
var useMemo = (factory, deps) => {
  const buildData = buildDataStack.at(-1);
  if (!buildData) {
    return factory();
  }
  const [, node] = buildData;
  const memoArray = node[DOM_STASH][1][STASH_MEMO] ||= [];
  const hookIndex = node[DOM_STASH][0]++;
  const prevDeps = memoArray[hookIndex];
  if (isDepsChanged(prevDeps?.[1], deps)) {
    memoArray[hookIndex] = [factory(), deps];
  }
  return memoArray[hookIndex][0];
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/hooks/index.js
var FormContext = createContext({
  pending: false,
  data: null,
  method: null,
  action: null
});
var actions = /* @__PURE__ */ new Set;
var registerAction = (action) => {
  actions.add(action);
  action.finally(() => actions.delete(action));
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/intrinsic-element/components.js
var clearCache = () => {
  blockingPromiseMap = /* @__PURE__ */ Object.create(null);
  createdElements = /* @__PURE__ */ Object.create(null);
};
var composeRef = (ref, cb) => {
  return useMemo(() => (e) => {
    let refCleanup;
    if (ref) {
      if (typeof ref === "function") {
        refCleanup = ref(e) || (() => {
          ref(null);
        });
      } else if (ref && "current" in ref) {
        ref.current = e;
        refCleanup = () => {
          ref.current = null;
        };
      }
    }
    const cbCleanup = cb(e);
    return () => {
      cbCleanup?.();
      refCleanup?.();
    };
  }, [ref]);
};
var blockingPromiseMap = /* @__PURE__ */ Object.create(null);
var createdElements = /* @__PURE__ */ Object.create(null);
var documentMetadataTag = (tag, props, preserveNodeType, supportSort, supportBlocking) => {
  if (props?.itemProp) {
    return {
      tag,
      props,
      type: tag,
      ref: props.ref
    };
  }
  const head = document.head;
  let { onLoad, onError, precedence, blocking, ...restProps } = props;
  let element = null;
  let created = false;
  const deDupeKeys = deDupeKeyMap[tag];
  let existingElements = undefined;
  if (deDupeKeys.length > 0) {
    const tags = head.querySelectorAll(tag);
    LOOP:
      for (const e of tags) {
        for (const key of deDupeKeyMap[tag]) {
          if (e.getAttribute(key) === props[key]) {
            element = e;
            break LOOP;
          }
        }
      }
    if (!element) {
      const cacheKey = deDupeKeys.reduce((acc, key) => props[key] === undefined ? acc : `${acc}-${key}-${props[key]}`, tag);
      created = !createdElements[cacheKey];
      element = createdElements[cacheKey] ||= (() => {
        const e = document.createElement(tag);
        for (const key of deDupeKeys) {
          if (props[key] !== undefined) {
            e.setAttribute(key, props[key]);
          }
          if (props.rel) {
            e.setAttribute("rel", props.rel);
          }
        }
        return e;
      })();
    }
  } else {
    existingElements = head.querySelectorAll(tag);
  }
  precedence = supportSort ? precedence ?? "" : undefined;
  if (supportSort) {
    restProps[dataPrecedenceAttr] = precedence;
  }
  const insert = useCallback((e) => {
    if (deDupeKeys.length > 0) {
      let found = false;
      for (const existingElement of head.querySelectorAll(tag)) {
        if (found && existingElement.getAttribute(dataPrecedenceAttr) !== precedence) {
          head.insertBefore(e, existingElement);
          return;
        }
        if (existingElement.getAttribute(dataPrecedenceAttr) === precedence) {
          found = true;
        }
      }
      head.appendChild(e);
    } else if (existingElements) {
      let found = false;
      for (const existingElement of existingElements) {
        if (existingElement === e) {
          found = true;
          break;
        }
      }
      if (!found) {
        head.insertBefore(e, head.contains(existingElements[0]) ? existingElements[0] : head.querySelector(tag));
      }
      existingElements = undefined;
    }
  }, [precedence]);
  const ref = composeRef(props.ref, (e) => {
    const key = deDupeKeys[0];
    if (preserveNodeType === 2) {
      e.innerHTML = "";
    }
    if (created || existingElements) {
      insert(e);
    }
    if (!onError && !onLoad) {
      return;
    }
    let promise = blockingPromiseMap[e.getAttribute(key)] ||= new Promise((resolve, reject) => {
      e.addEventListener("load", resolve);
      e.addEventListener("error", reject);
    });
    if (onLoad) {
      promise = promise.then(onLoad);
    }
    if (onError) {
      promise = promise.catch(onError);
    }
    promise.catch(() => {});
  });
  if (supportBlocking && blocking === "render") {
    const key = deDupeKeyMap[tag][0];
    if (props[key]) {
      const value = props[key];
      const promise = blockingPromiseMap[value] ||= new Promise((resolve, reject) => {
        insert(element);
        element.addEventListener("load", resolve);
        element.addEventListener("error", reject);
      });
      use(promise);
    }
  }
  const jsxNode = {
    tag,
    type: tag,
    props: {
      ...restProps,
      ref
    },
    ref
  };
  jsxNode.p = preserveNodeType;
  if (element) {
    jsxNode.e = element;
  }
  return createPortal(jsxNode, head);
};
var title = (props) => {
  const nameSpaceContext3 = getNameSpaceContext2();
  const ns = nameSpaceContext3 && useContext(nameSpaceContext3);
  if (ns?.endsWith("svg")) {
    return {
      tag: "title",
      props,
      type: "title",
      ref: props.ref
    };
  }
  return documentMetadataTag("title", props, undefined, false, false);
};
var script = (props) => {
  if (!props || ["src", "async"].some((k) => !props[k])) {
    return {
      tag: "script",
      props,
      type: "script",
      ref: props.ref
    };
  }
  return documentMetadataTag("script", props, 1, false, true);
};
var style = (props) => {
  if (!props || !["href", "precedence"].every((k) => (k in props))) {
    return {
      tag: "style",
      props,
      type: "style",
      ref: props.ref
    };
  }
  props["data-href"] = props.href;
  delete props.href;
  return documentMetadataTag("style", props, 2, true, true);
};
var link = (props) => {
  if (!props || ["onLoad", "onError"].some((k) => (k in props)) || props.rel === "stylesheet" && (!("precedence" in props) || ("disabled" in props))) {
    return {
      tag: "link",
      props,
      type: "link",
      ref: props.ref
    };
  }
  return documentMetadataTag("link", props, 1, "precedence" in props, true);
};
var meta = (props) => {
  return documentMetadataTag("meta", props, undefined, false, false);
};
var customEventFormAction = /* @__PURE__ */ Symbol();
var form = (props) => {
  const { action, ...restProps } = props;
  if (typeof action !== "function") {
    restProps.action = action;
  }
  const [state, setState] = useState([null, false]);
  const onSubmit = useCallback(async (ev) => {
    const currentAction = ev.isTrusted ? action : ev.detail[customEventFormAction];
    if (typeof currentAction !== "function") {
      return;
    }
    ev.preventDefault();
    const formData = new FormData(ev.target);
    setState([formData, true]);
    const actionRes = currentAction(formData);
    if (actionRes instanceof Promise) {
      registerAction(actionRes);
      await actionRes;
    }
    setState([null, true]);
  }, []);
  const ref = composeRef(props.ref, (el) => {
    el.addEventListener("submit", onSubmit);
    return () => {
      el.removeEventListener("submit", onSubmit);
    };
  });
  const [data, isDirty] = state;
  state[1] = false;
  return {
    tag: FormContext,
    props: {
      value: {
        pending: data !== null,
        data,
        method: data ? "post" : null,
        action: data ? action : null
      },
      children: {
        tag: "form",
        props: {
          ...restProps,
          ref
        },
        type: "form",
        ref
      }
    },
    f: isDirty
  };
};
var formActionableElement = (tag, {
  formAction,
  ...props
}) => {
  if (typeof formAction === "function") {
    const onClick = useCallback((ev) => {
      ev.preventDefault();
      ev.currentTarget.form.dispatchEvent(new CustomEvent("submit", { detail: { [customEventFormAction]: formAction } }));
    }, []);
    props.ref = composeRef(props.ref, (el) => {
      el.addEventListener("click", onClick);
      return () => {
        el.removeEventListener("click", onClick);
      };
    });
  }
  return {
    tag,
    props,
    type: tag,
    ref: props.ref
  };
};
var input = (props) => formActionableElement("input", props);
var button = (props) => formActionableElement("button", props);
Object.assign(domRenderers, {
  title,
  script,
  style,
  link,
  meta,
  form,
  input,
  button
});

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/jsx-dev-runtime.js
var jsxDEV = (tag, props, key) => {
  if (typeof tag === "string" && exports_components2[tag]) {
    tag = exports_components2[tag];
  }
  return {
    tag,
    type: tag,
    props,
    key,
    ref: props.ref
  };
};
var Fragment = (props) => jsxDEV("", props, undefined);

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/dom/components.js
var ErrorBoundary = ({ children, fallback, fallbackRender, onError }) => {
  const res = Fragment({ children });
  res[DOM_ERROR_HANDLER] = (err) => {
    if (err instanceof Promise) {
      throw err;
    }
    onError?.(err);
    return fallbackRender?.(err) || fallback;
  };
  return res;
};
var Suspense = ({
  children,
  fallback
}) => {
  const res = Fragment({ children });
  res[DOM_ERROR_HANDLER] = (err, retry) => {
    if (!(err instanceof Promise)) {
      throw err;
    }
    err.finally(retry);
    return fallback;
  };
  return res;
};

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/streaming.js
var StreamingContext = createContext2(null);
var suspenseCounter = 0;
var Suspense2 = async ({
  children,
  fallback
}) => {
  if (!Array.isArray(children)) {
    children = [children];
  }
  const nonce = useContext(StreamingContext)?.scriptNonce;
  let resArray = [];
  const stackNode = { [DOM_STASH]: [0, []] };
  const popNodeStack = (value) => {
    buildDataStack.pop();
    return value;
  };
  try {
    stackNode[DOM_STASH][0] = 0;
    buildDataStack.push([[], stackNode]);
    resArray = children.map((c) => c == null || typeof c === "boolean" ? "" : c.toString());
  } catch (e) {
    if (e instanceof Promise) {
      resArray = [
        e.then(() => {
          stackNode[DOM_STASH][0] = 0;
          buildDataStack.push([[], stackNode]);
          return childrenToString(children).then(popNodeStack);
        })
      ];
    } else {
      throw e;
    }
  } finally {
    popNodeStack();
  }
  if (resArray.some((res) => res instanceof Promise)) {
    const index = suspenseCounter++;
    const fallbackStr = await fallback.toString();
    return raw(`<template id="H:${index}"></template>${fallbackStr}<!--/$-->`, [
      ...fallbackStr.callbacks || [],
      ({ phase, buffer, context }) => {
        if (phase === HtmlEscapedCallbackPhase.BeforeStream) {
          return;
        }
        return Promise.all(resArray).then(async (htmlArray) => {
          htmlArray = htmlArray.flat();
          const content = htmlArray.join("");
          if (buffer) {
            buffer[0] = buffer[0].replace(new RegExp(`<template id="H:${index}"></template>.*?<!--/\\$-->`), content);
          }
          let html = buffer ? "" : `<template data-hono-target="H:${index}">${content}</template><script${nonce ? ` nonce="${nonce}"` : ""}>
((d,c,n) => {
c=d.currentScript.previousSibling
d=d.getElementById('H:${index}')
if(!d)return
do{n=d.nextSibling;n.remove()}while(n.nodeType!=8||n.nodeValue!='/$')
d.replaceWith(c.content)
})(document)
</script>`;
          const callbacks = htmlArray.map((html2) => html2.callbacks || []).flat();
          if (!callbacks.length) {
            return html;
          }
          if (phase === HtmlEscapedCallbackPhase.Stream) {
            html = await resolveCallback(html, HtmlEscapedCallbackPhase.BeforeStream, true, context);
          }
          return raw(html, callbacks);
        });
      }
    ]);
  } else {
    return raw(resArray.join(""));
  }
};
Suspense2[DOM_RENDERER] = Suspense;
var textEncoder = new TextEncoder;

// ../../node_modules/.bun/hono@4.11.4/node_modules/hono/dist/jsx/components.js
var errorBoundaryCounter = 0;
var childrenToString = async (children) => {
  try {
    return children.flat().map((c) => c == null || typeof c === "boolean" ? "" : c.toString());
  } catch (e) {
    if (e instanceof Promise) {
      await e;
      return childrenToString(children);
    } else {
      throw e;
    }
  }
};
var ErrorBoundary2 = async ({ children, fallback, fallbackRender, onError }) => {
  if (!children) {
    return raw("");
  }
  if (!Array.isArray(children)) {
    children = [children];
  }
  const nonce = useContext(StreamingContext)?.scriptNonce;
  let fallbackStr;
  const fallbackRes = (error) => {
    onError?.(error);
    return (fallbackStr || fallbackRender?.(error) || "").toString();
  };
  let resArray = [];
  try {
    resArray = children.map((c) => c == null || typeof c === "boolean" ? "" : c.toString());
  } catch (e) {
    fallbackStr = await fallback?.toString();
    if (e instanceof Promise) {
      resArray = [
        e.then(() => childrenToString(children)).catch((e2) => fallbackRes(e2))
      ];
    } else {
      resArray = [fallbackRes(e)];
    }
  }
  if (resArray.some((res) => res instanceof Promise)) {
    fallbackStr ||= await fallback?.toString();
    const index = errorBoundaryCounter++;
    const replaceRe = RegExp(`(<template id="E:${index}"></template>.*?)(.*?)(<!--E:${index}-->)`);
    const caught = false;
    const catchCallback = ({ error: error2, buffer }) => {
      if (caught) {
        return "";
      }
      const fallbackResString = fallbackRes(error2);
      if (buffer) {
        buffer[0] = buffer[0].replace(replaceRe, fallbackResString);
      }
      return buffer ? "" : `<template data-hono-target="E:${index}">${fallbackResString}</template><script>
((d,c,n) => {
c=d.currentScript.previousSibling
d=d.getElementById('E:${index}')
if(!d)return
do{n=d.nextSibling;n.remove()}while(n.nodeType!=8||n.nodeValue!='E:${index}')
d.replaceWith(c.content)
})(document)
</script>`;
    };
    let error;
    const promiseAll = Promise.all(resArray).catch((e) => error = e);
    return raw(`<template id="E:${index}"></template><!--E:${index}-->`, [
      ({ phase, buffer, context }) => {
        if (phase === HtmlEscapedCallbackPhase.BeforeStream) {
          return;
        }
        return promiseAll.then(async (htmlArray) => {
          if (error) {
            throw error;
          }
          htmlArray = htmlArray.flat();
          const content = htmlArray.join("");
          let html = buffer ? "" : `<template data-hono-target="E:${index}">${content}</template><script${nonce ? ` nonce="${nonce}"` : ""}>
((d,c) => {
c=d.currentScript.previousSibling
d=d.getElementById('E:${index}')
if(!d)return
d.parentElement.insertBefore(c.content,d.nextSibling)
})(document)
</script>`;
          if (htmlArray.every((html2) => !html2.callbacks?.length)) {
            if (buffer) {
              buffer[0] = buffer[0].replace(replaceRe, content);
            }
            return html;
          }
          if (buffer) {
            buffer[0] = buffer[0].replace(replaceRe, (_all, pre, _, post) => `${pre}${content}${post}`);
          }
          const callbacks = htmlArray.map((html2) => html2.callbacks || []).flat();
          if (phase === HtmlEscapedCallbackPhase.Stream) {
            html = await resolveCallback(html, HtmlEscapedCallbackPhase.BeforeStream, true, context);
          }
          let resolvedCount = 0;
          const promises = callbacks.map((c) => (...args) => c(...args)?.then((content2) => {
            resolvedCount++;
            if (buffer) {
              if (resolvedCount === callbacks.length) {
                buffer[0] = buffer[0].replace(replaceRe, (_all, _pre, content3) => content3);
              }
              buffer[0] += content2;
              return raw("", content2.callbacks);
            }
            return raw(content2 + (resolvedCount !== callbacks.length ? "" : `<script>
((d,c,n) => {
d=d.getElementById('E:${index}')
if(!d)return
n=d.nextSibling
while(n.nodeType!=8||n.nodeValue!='E:${index}'){n=n.nextSibling}
n.remove()
d.remove()
})(document)
</script>`), content2.callbacks);
          }).catch((error2) => catchCallback({ error: error2, buffer })));
          return raw(html, promises);
        }).catch((error2) => catchCallback({ error: error2, buffer }));
      }
    ]);
  } else {
    return raw(resArray.join(""));
  }
};
ErrorBoundary2[DOM_RENDERER] = ErrorBoundary;

// ui/client.tsx
var LOG_LIMIT = 200;
var LOGS_ENDPOINT = "/api/logs";
var LOGS_STREAM_ENDPOINT = "/api/logs/stream";
function setupTabs() {
  const buttons = Array.from(document.querySelectorAll("[data-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  const activate = (tab) => {
    for (const btn of buttons) {
      const isActive = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    }
    for (const panel of panels) {
      const isActive = panel.getAttribute("data-tab-panel") === tab;
      panel.classList.toggle("hidden", !isActive);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
    document.body.dataset.activeTab = tab;
    document.documentElement.dataset.activeTab = tab;
    window.dispatchEvent(new CustomEvent("tab-change", { detail: { tab } }));
  };
  const handlers = new Map;
  for (const btn of buttons) {
    const handler = () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) {
        activate(tab);
      }
    };
    handlers.set(btn, handler);
    btn.addEventListener("click", handler);
  }
  const root = document.getElementById("client-root");
  const initialTab = root?.getAttribute("data-active-tab") || new URLSearchParams(window.location.search).get("tab");
  if (initialTab) {
    activate(initialTab);
  }
  return () => {
    for (const [btn, handler] of handlers.entries()) {
      btn.removeEventListener("click", handler);
    }
  };
}
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}
function statusClass(status) {
  if (!status) {
    return "log-status";
  }
  if (status >= 500) {
    return "log-status log-status--error";
  }
  if (status >= 400) {
    return "log-status log-status--warn";
  }
  return "log-status log-status--ok";
}
function rangeToFrom(range) {
  const now = Date.now();
  switch (range) {
    case "30m":
      return now - 30 * 60 * 1000;
    case "2h":
      return now - 2 * 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    default:
      return;
  }
}
function entrySearchText(entry) {
  return [
    entry.message,
    entry.source ?? "",
    entry.request?.method ?? "",
    entry.request?.path ?? "",
    entry.request?.host ?? "",
    entry.request?.status?.toString() ?? "",
    entry.error?.message ?? ""
  ].join(" ").toLowerCase();
}
function setupLogs() {
  const root = document.querySelector("[data-log-root]");
  if (!root) {
    return null;
  }
  const list = root.querySelector("[data-log-list]");
  const empty = root.querySelector("[data-log-empty]");
  const searchInput = root.querySelector("[data-log-search]");
  const rangeSelect = root.querySelector("[data-log-range]");
  const resetButton = root.querySelector("[data-log-reset]");
  const liveButton = root.querySelector("[data-log-live]");
  const refreshButton = root.querySelector("[data-log-refresh]");
  const detailPanel = root.querySelector("[data-log-detail]");
  const detailClose = root.querySelector("[data-log-detail-close]");
  const levelInputs = Array.from(root.querySelectorAll("[data-log-level]"));
  const statusInputs = Array.from(root.querySelectorAll("[data-log-status]"));
  const countNodes = new Map;
  for (const node of root.querySelectorAll("[data-log-count]")) {
    const key = node.getAttribute("data-log-count");
    if (key) {
      countNodes.set(key, node);
    }
  }
  const statusCountNodes = new Map;
  for (const node of root.querySelectorAll("[data-log-status-count]")) {
    const key = node.getAttribute("data-log-status-count");
    if (key) {
      statusCountNodes.set(key, node);
    }
  }
  if (!(list && empty && searchInput && rangeSelect && liveButton)) {
    return null;
  }
  const state = {
    levels: new Set,
    statuses: new Set,
    search: "",
    range: rangeSelect.value || "30m",
    rawEntries: [],
    live: liveButton.classList.contains("is-live"),
    selectedId: null
  };
  for (const input2 of levelInputs) {
    if (input2.checked) {
      const level = input2.getAttribute("data-log-level");
      if (level) {
        state.levels.add(level);
      }
    }
  }
  for (const input2 of statusInputs) {
    if (input2.checked) {
      const status = input2.getAttribute("data-log-status");
      if (status) {
        state.statuses.add(status);
      }
    }
  }
  let debounceTimer = null;
  let eventSource = null;
  const levelHandlers = new Map;
  const statusHandlers = new Map;
  const listClickHandler = (event) => handleRowSelect(event.target);
  const detailCloseHandler = () => selectEntry(null);
  const detailElements = {
    method: root.querySelector("[data-log-detail-method]"),
    path: root.querySelector("[data-log-detail-path]"),
    status: root.querySelector("[data-log-detail-status]"),
    time: root.querySelector("[data-log-detail-time]"),
    id: root.querySelector("[data-log-detail-id]"),
    host: root.querySelector("[data-log-detail-host]"),
    duration: root.querySelector("[data-log-detail-duration]"),
    source: root.querySelector("[data-log-detail-source]"),
    message: root.querySelector("[data-log-detail-message]"),
    stack: root.querySelector("[data-log-detail-stack]")
  };
  const updateCounts = () => {
    const counts = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0
    };
    const statusCounts = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      system: 0
    };
    for (const entry of state.rawEntries) {
      counts[entry.level] += 1;
      const status = entry.request?.status;
      if (status) {
        const bucket = `${Math.floor(status / 100)}xx`;
        if (statusCounts[bucket] !== undefined) {
          statusCounts[bucket] += 1;
        }
      } else {
        statusCounts.system += 1;
      }
    }
    for (const [key, node] of countNodes.entries()) {
      const level = key;
      node.textContent = String(counts[level] ?? 0);
    }
    for (const [key, node] of statusCountNodes.entries()) {
      node.textContent = String(statusCounts[key] ?? 0);
    }
  };
  const renderEntries = (entries) => {
    list.innerHTML = "";
    if (!entries.length) {
      empty.textContent = "No logs found for the selected filters.";
      list.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = `log-entry log-entry--${entry.level}`;
      row.dataset.logId = entry.id;
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      if (entry.id === state.selectedId) {
        row.classList.add("is-selected");
      }
      const timeCell = document.createElement("div");
      timeCell.className = "log-cell";
      timeCell.textContent = formatTimestamp(entry.timestamp);
      const statusCell = document.createElement("div");
      statusCell.className = `log-cell ${statusClass(entry.request?.status)}`;
      statusCell.textContent = entry.request?.status?.toString() ?? "--";
      const hostCell = document.createElement("div");
      hostCell.className = "log-cell";
      hostCell.textContent = entry.request?.host ?? "--";
      const requestCell = document.createElement("div");
      requestCell.className = "log-cell log-request";
      if (entry.request) {
        requestCell.textContent = `${entry.request.method} ${entry.request.path}`;
      } else {
        requestCell.textContent = entry.source ?? "--";
      }
      const messageCell = document.createElement("div");
      messageCell.className = "log-cell log-message";
      const durationText = entry.request?.durationMs ? `${entry.request.durationMs}ms` : undefined;
      messageCell.textContent = entry.error?.message ?? durationText ?? entry.message;
      messageCell.title = messageCell.textContent;
      row.append(timeCell, statusCell, hostCell, requestCell, messageCell);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
  };
  const renderDetail = (entry) => {
    if (!detailPanel) {
      return;
    }
    if (!entry) {
      detailPanel.classList.add("is-empty");
      if (detailElements.method) {
        detailElements.method.textContent = "--";
      }
      if (detailElements.path) {
        detailElements.path.textContent = "Pick a request";
      }
      if (detailElements.status) {
        detailElements.status.textContent = "--";
        detailElements.status.className = "log-status";
      }
      if (detailElements.time) {
        detailElements.time.textContent = "--";
      }
      if (detailElements.id) {
        detailElements.id.textContent = "--";
      }
      if (detailElements.host) {
        detailElements.host.textContent = "--";
      }
      if (detailElements.duration) {
        detailElements.duration.textContent = "--";
      }
      if (detailElements.source) {
        detailElements.source.textContent = "--";
      }
      if (detailElements.message) {
        detailElements.message.textContent = "--";
      }
      if (detailElements.stack) {
        detailElements.stack.textContent = "";
      }
      return;
    }
    detailPanel.classList.remove("is-empty");
    const statusValue = entry.request?.status;
    if (detailElements.method) {
      detailElements.method.textContent = entry.request?.method ?? entry.level;
    }
    if (detailElements.path) {
      detailElements.path.textContent = entry.request?.path ?? entry.message;
    }
    if (detailElements.status) {
      detailElements.status.textContent = statusValue ? String(statusValue) : entry.level.toUpperCase();
      detailElements.status.className = statusClass(statusValue);
    }
    if (detailElements.time) {
      detailElements.time.textContent = formatTimestamp(entry.timestamp);
    }
    if (detailElements.id) {
      detailElements.id.textContent = entry.id;
    }
    if (detailElements.host) {
      detailElements.host.textContent = entry.request?.host ?? "--";
    }
    if (detailElements.duration) {
      detailElements.duration.textContent = entry.request?.durationMs ? `${entry.request.durationMs}ms` : "--";
    }
    if (detailElements.source) {
      detailElements.source.textContent = entry.source ?? "--";
    }
    if (detailElements.message) {
      detailElements.message.textContent = entry.error?.message ?? entry.message;
    }
    if (detailElements.stack) {
      detailElements.stack.textContent = entry.error?.stack ?? "";
    }
  };
  const applyFilters = () => {
    const searchText = state.search.toLowerCase();
    const hasSearch = searchText.length > 0;
    if (state.levels.size === 0 || state.statuses.size === 0) {
      renderEntries([]);
      return;
    }
    const filtered = state.rawEntries.filter((entry) => {
      if (state.levels.size > 0 && !state.levels.has(entry.level)) {
        return false;
      }
      const status = entry.request?.status;
      const bucket = status ? `${Math.floor(status / 100)}xx` : "system";
      if (state.statuses.size > 0 && !state.statuses.has(bucket)) {
        return false;
      }
      if (hasSearch && !entrySearchText(entry).includes(searchText)) {
        return false;
      }
      return true;
    });
    renderEntries(filtered);
    if (state.selectedId) {
      const selected = filtered.find((entry) => entry.id === state.selectedId) ?? state.rawEntries.find((entry) => entry.id === state.selectedId) ?? null;
      if (!selected) {
        state.selectedId = null;
      }
      renderDetail(selected);
    } else {
      renderDetail(null);
    }
  };
  const fetchLogs = async () => {
    const params = new URLSearchParams;
    params.set("limit", String(LOG_LIMIT));
    params.set("order", "desc");
    const from = rangeToFrom(state.range);
    if (from) {
      params.set("from", String(from));
    }
    try {
      empty.textContent = "Loading logs...";
      const response = await fetch(`${LOGS_ENDPOINT}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      state.rawEntries = Array.isArray(data.entries) ? data.entries : [];
      updateCounts();
      applyFilters();
    } catch (error) {
      list.innerHTML = "";
      empty.textContent = "Failed to load logs.";
      list.appendChild(empty);
      if (console?.error) {
        console.error("Failed to fetch logs:", error);
      }
    }
  };
  const handleLiveEntry = (entry) => {
    const from = rangeToFrom(state.range);
    if (from && entry.timestamp < from) {
      return;
    }
    state.rawEntries.unshift(entry);
    if (state.rawEntries.length > LOG_LIMIT) {
      state.rawEntries.pop();
    }
    updateCounts();
    applyFilters();
  };
  const openLive = () => {
    if (eventSource) {
      return;
    }
    eventSource = new EventSource(LOGS_STREAM_ENDPOINT);
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        handleLiveEntry(parsed);
      } catch (error) {
        if (console?.error) {
          console.error("Failed to parse log entry:", error);
        }
      }
    };
    eventSource.onerror = () => {};
  };
  const closeLive = () => {
    if (!eventSource) {
      return;
    }
    eventSource.close();
    eventSource = null;
  };
  const setLive = (enabled) => {
    state.live = enabled;
    liveButton.classList.toggle("is-live", enabled);
    liveButton.setAttribute("aria-pressed", String(enabled));
    if (enabled && isLogsActive()) {
      openLive();
    } else {
      closeLive();
    }
  };
  const isLogsActive = () => {
    const panel = document.querySelector('[data-tab-panel="logs"]');
    return panel ? !panel.classList.contains("hidden") : false;
  };
  const handleTabChange = (event) => {
    const detail = event.detail;
    if (detail?.tab === "logs") {
      fetchLogs();
      if (state.live) {
        openLive();
      }
    } else {
      closeLive();
    }
  };
  const handleSearch = () => {
    state.search = searchInput.value.trim();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      applyFilters();
    }, 200);
  };
  const handleRangeChange = () => {
    state.range = rangeSelect.value;
    fetchLogs();
  };
  const handleLevelToggle = (input2) => {
    const level = input2.getAttribute("data-log-level");
    if (!level) {
      return;
    }
    if (input2.checked) {
      state.levels.add(level);
    } else {
      state.levels.delete(level);
    }
    applyFilters();
  };
  const handleStatusToggle = (input2) => {
    const status = input2.getAttribute("data-log-status");
    if (!status) {
      return;
    }
    if (input2.checked) {
      state.statuses.add(status);
    } else {
      state.statuses.delete(status);
    }
    applyFilters();
  };
  const handleReset = () => {
    searchInput.value = "";
    state.search = "";
    rangeSelect.value = "30m";
    state.range = "30m";
    state.levels.clear();
    state.statuses.clear();
    for (const input2 of levelInputs) {
      input2.checked = input2.getAttribute("data-log-level") !== "debug";
      const level = input2.getAttribute("data-log-level");
      if (level) {
        if (input2.checked) {
          state.levels.add(level);
        } else {
          state.levels.delete(level);
        }
      }
    }
    for (const input2 of statusInputs) {
      input2.checked = true;
      const status = input2.getAttribute("data-log-status");
      if (status) {
        state.statuses.add(status);
      }
    }
    fetchLogs();
  };
  const selectEntry = (entry) => {
    state.selectedId = entry?.id ?? null;
    renderDetail(entry);
    for (const row of list.querySelectorAll(".log-entry")) {
      const id = row.getAttribute("data-log-id");
      row.classList.toggle("is-selected", id === state.selectedId);
    }
  };
  const handleRowSelect = (target) => {
    if (!target) {
      return;
    }
    const row = target.closest(".log-entry");
    if (!row) {
      return;
    }
    const id = row.getAttribute("data-log-id");
    if (!id) {
      return;
    }
    const entry = state.rawEntries.find((item) => item.id === id) ?? null;
    selectEntry(entry);
  };
  const handleRowKeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    handleRowSelect(event.target);
  };
  const handleRefresh = () => {
    fetchLogs();
  };
  const handleLiveToggle = () => {
    setLive(!state.live);
  };
  searchInput.addEventListener("input", handleSearch);
  rangeSelect.addEventListener("change", handleRangeChange);
  resetButton?.addEventListener("click", handleReset);
  refreshButton?.addEventListener("click", handleRefresh);
  liveButton.addEventListener("click", handleLiveToggle);
  detailClose?.addEventListener("click", detailCloseHandler);
  list.addEventListener("click", listClickHandler);
  list.addEventListener("keydown", handleRowKeydown);
  for (const input2 of levelInputs) {
    const handler = () => handleLevelToggle(input2);
    levelHandlers.set(input2, handler);
    input2.addEventListener("change", handler);
  }
  for (const input2 of statusInputs) {
    const handler = () => handleStatusToggle(input2);
    statusHandlers.set(input2, handler);
    input2.addEventListener("change", handler);
  }
  window.addEventListener("tab-change", handleTabChange);
  fetchLogs();
  if (state.live && isLogsActive()) {
    openLive();
  }
  return () => {
    searchInput.removeEventListener("input", handleSearch);
    rangeSelect.removeEventListener("change", handleRangeChange);
    resetButton?.removeEventListener("click", handleReset);
    refreshButton?.removeEventListener("click", handleRefresh);
    liveButton.removeEventListener("click", handleLiveToggle);
    detailClose?.removeEventListener("click", detailCloseHandler);
    list.removeEventListener("click", listClickHandler);
    list.removeEventListener("keydown", handleRowKeydown);
    for (const [input2, handler] of levelHandlers.entries()) {
      input2.removeEventListener("change", handler);
    }
    for (const [input2, handler] of statusHandlers.entries()) {
      input2.removeEventListener("change", handler);
    }
    window.removeEventListener("tab-change", handleTabChange);
    closeLive();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  };
}
function ClientApp() {
  useEffect(() => {
    const cleanupTabs = setupTabs();
    const cleanupLogs = setupLogs();
    return () => {
      cleanupTabs();
      cleanupLogs();
    };
  }, []);
  return null;
}
var root = document.getElementById("client-root");
if (root) {
  render(/* @__PURE__ */ jsxDEV(ClientApp, {}, undefined, false, undefined, this), root);
}
