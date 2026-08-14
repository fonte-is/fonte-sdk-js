export type CallbackPageOutcome = "success" | "failure";

const content = {
  success: {
    title: "Authorization complete",
    description: "Return to your terminal to continue.",
    detail: "You can close this tab.",
  },
  failure: {
    title: "Authorization not completed",
    description: "Return to your terminal for the reason, then try again.",
    detail: "No credential was stored by this page.",
  },
} as const;

const fonteMark = `<svg aria-hidden="true" viewBox="0 0 38 38" fill="none">
  <path d="M34.7188 15.7682C32.9352 15.7682 31.4897 17.2154 31.4897 19.0009C31.4897 20.7863 32.9352 22.2336 34.7188 22.2336C36.5025 22.2336 37.9462 20.7863 37.9462 19.0009C37.9462 17.2154 36.5007 15.7682 34.7188 15.7682Z" fill="currentColor"/>
  <path d="M26.8463 30.1179C28.63 30.1179 30.0754 28.6706 30.0754 26.8852C30.0754 25.0997 28.63 23.6525 26.8463 23.6525C25.0626 23.6525 23.6172 25.0997 23.6172 26.8852C23.6172 28.6706 25.0626 30.1179 26.8463 30.1179Z" fill="currentColor"/>
  <path d="M3.22914 15.7682C1.44547 15.7682 0 17.2154 0 19.0009C0 20.7863 1.44547 22.2336 3.22914 22.2336C3.59229 22.2336 3.94294 22.173 4.27048 22.0609L8.04435 25.8401C7.93398 26.1676 7.87168 26.5183 7.87168 26.8832C7.87168 28.6687 9.31711 30.1159 11.1008 30.1159C11.4657 30.1159 11.8146 30.0554 12.1439 29.945L15.9178 33.7242C15.8056 34.0517 15.7451 34.4024 15.7451 34.7673C15.7451 36.5527 17.1905 38 18.9742 38C20.7579 38 22.2033 36.5527 22.2033 34.7673C22.2033 32.9818 20.7579 31.5346 18.9742 31.5346C18.6093 31.5346 18.2586 31.5951 17.9328 31.7055L14.159 27.9263C14.2694 27.5988 14.3317 27.2481 14.3317 26.8832C14.3317 26.5183 14.2712 26.1676 14.1608 25.8401L17.9346 22.0609C18.2621 22.173 18.6111 22.2336 18.976 22.2336C20.7597 22.2336 22.2051 20.7863 22.2051 19.0009C22.2051 17.2154 20.7597 15.7682 18.976 15.7682C17.1923 15.7682 15.7469 17.2154 15.7469 19.0009C15.7469 19.3658 15.8074 19.7165 15.9196 20.044L12.1457 23.8232C11.8181 23.711 11.4675 23.6505 11.1026 23.6505C10.7376 23.6505 10.3887 23.711 10.0612 23.8214L6.28736 20.0422C6.39951 19.7165 6.46003 19.364 6.46003 18.9991C6.46003 18.6342 6.39951 18.2835 6.28736 17.9559L10.0612 14.1768C10.3887 14.2889 10.7376 14.3477 11.1026 14.3477C12.8862 14.3477 14.3317 12.9004 14.3317 11.115C14.3317 10.7501 14.2712 10.3994 14.1608 10.0718L17.9346 6.29266C18.2621 6.40481 18.6111 6.46533 18.976 6.46533C20.7597 6.46533 22.2051 5.01811 22.2051 3.23266C22.2051 1.44721 20.7597 0 18.976 0C17.1923 0 15.7469 1.44721 15.7469 3.23266C15.7469 3.59759 15.8074 3.94829 15.9196 4.27583L12.1457 8.055C11.8181 7.94463 11.4675 7.88407 11.1026 7.88407C9.3189 7.88407 7.87342 9.33133 7.87342 11.1168C7.87342 11.4817 7.93399 11.8324 8.04613 12.1599L4.27226 15.9391C3.94472 15.8269 3.59407 15.7664 3.23093 15.7664L3.22914 15.7682Z" fill="currentColor"/>
  <path d="M26.8463 14.3515C28.63 14.3515 30.0754 12.9043 30.0754 11.1189C30.0754 9.33343 28.63 7.88617 26.8463 7.88617C25.0626 7.88617 23.6172 9.33343 23.6172 11.1189C23.6172 12.9043 25.0626 14.3515 26.8463 14.3515Z" fill="currentColor"/>
</svg>`;

const styles = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #ffffff;
    color: #181d27;
  }
  * { box-sizing: border-box; }
  body {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    display: flex;
    align-items: center;
    padding: 48px 20px;
    background: #ffffff;
  }
  main {
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
  }
  .fonte-mark {
    width: 40px;
    height: 40px;
    color: #1570ef;
  }
  .message { text-align: center; }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }
  .description {
    margin: 8px 0 0;
    color: #535862;
    font-size: 15px;
    line-height: 1.5;
  }
  .detail {
    margin: 12px 0 0;
    color: #717680;
    font-size: 14px;
    line-height: 1.5;
  }
`;

export function renderCallbackPage(outcome: CallbackPageOutcome): string {
  const copy = content[outcome];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${copy.title} · Fonte</title>
    <style>${styles}</style>
  </head>
  <body data-outcome="${outcome}">
    <main>
      <span class="fonte-mark">${fonteMark}</span>
      <div class="message">
        <h1 id="callback-title">${copy.title}</h1>
        <p class="description">${copy.description}</p>
        <p class="detail">${copy.detail}</p>
      </div>
    </main>
  </body>
</html>`;
}
