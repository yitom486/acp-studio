import { test, expect } from "@playwright/test";
import { launchElectronApp, type LaunchedApp } from "./helpers/launch-electron";

test.describe("Real Electron App - Generative UI Closed-Loop E2E", () => {
  let launched: LaunchedApp | undefined;
  let chatRequests: any[];

  test.beforeEach(async () => {
    launched = undefined;
    chatRequests = [];
    launched = await launchElectronApp();
    await launched.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    launched.page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/universal/chat") {
        chatRequests.push(request.postDataJSON());
      }
    });
  });

  test.afterEach(async ({}, info) => {
    if (launched) {
      try {
        if (info.status !== info.expectedStatus) {
          await info.attach("failure", { body: await launched.page.screenshot(), contentType: "image/png" });
          const trace = info.outputPath("trace.zip");
          await launched.app.context().tracing.stop({ path: trace });
          await info.attach("trace", { path: trace, contentType: "application/zip" });
        } else {
          await launched.app.context().tracing.stop();
        }
      } finally { await launched.cleanup(); }
    }
  });

  test("Flow 1: Agent calls studio-ui show_interactive_card -> renders DecisionCard -> user clicks choice -> original ACP session receives follow-up and continues answering", async () => {
    const { page } = launched!;

    // 1. Wait for workbench to load
    await page.waitForLoadState("domcontentloaded");
    const suggestionBtn = page.getByText("生成代码改进建议");
    await expect(suggestionBtn).toBeVisible({ timeout: 15000 });

    // 2. Click suggestion button to request architectural analysis & decision
    await suggestionBtn.click();

    // 3. Verify Agent tool call is dispatched and Generative UI DecisionCard is rendered
    const cardTitle = page.getByRole("heading", { name: "高可用服务架构选型", exact: true });
    await expect(cardTitle).toBeVisible({ timeout: 25000 });

    const recommendedOption = page.getByText("事件驱动微服务 (Kafka + Go)");
    await expect(recommendedOption).toBeVisible();

    const recommendedBadge = page.getByText("推荐");
    await expect(recommendedBadge).toBeVisible();

    const monolithOption = page.getByText("经典单体架构 (Postgres + Node)");
    await expect(monolithOption).toBeVisible();

    // 4. User interaction: user selects the recommended option
    await recommendedOption.click();

    // 5. Verify the follow-up prompt is dispatched to the active ACP session
    const dispatchedMessage = page.getByText("[方案决策: 高可用服务架构选型]");
    await expect(dispatchedMessage).toBeVisible({ timeout: 15000 });

    // 6. Verify original ACP session continues and streams agent follow-up answer
    const agentFollowup = page.getByText("【ACP 会话继续执行】已确认收到您选定的方案！");
    await expect(agentFollowup).toBeVisible({ timeout: 20000 });
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1].sessionId).toBe(chatRequests[0].sessionId);
    expect(chatRequests[1].prompt[0].text).toContain("opt-event-driven");
  });

  test("Flow 2: Agent calls studio-ui prompt_form -> renders FormCard -> user submits form -> original ACP session receives form payload and continues answering", async () => {
    const { page } = launched!;

    // 1. Wait for composer
    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    // 2. Send prompt requesting form configuration via composer
    await composerInput.click();
    await composerInput.fill("请打开服务部署参数配置表单");
    await composerInput.press("Enter");

    // 3. Verify PromptFormCard is rendered
    const formTitle = page.getByRole("heading", { name: "服务部署参数", exact: true });
    await expect(formTitle).toBeVisible({ timeout: 20000 });

    const clusterFieldLabel = page.getByText("集群名称");
    await expect(clusterFieldLabel).toBeVisible();

    const replicasFieldLabel = page.getByText("副本数量");
    await expect(replicasFieldLabel).toBeVisible();
    await page.locator("form input[type=text]").fill("e2e-cluster");
    await page.locator("form input[type=number]").fill("5");

    // 4. Verify submit button
    const submitBtn = page.locator('button:has-text("确认并部署")');
    await expect(submitBtn).toBeVisible();

    // 5. User submits form
    await submitBtn.click();

    // 6. Verify original ACP session receives form payload
    const formSubmittedPrompt = page.getByText("[表单提交: 服务部署参数]");
    await expect(formSubmittedPrompt).toBeVisible({ timeout: 15000 });

    // 7. Verify agent receives form payload and confirms execution
    const agentConfirmation = page.getByText("【ACP 会话继续执行】部署参数已提交验证，正在初始化集群副本！");
    await expect(agentConfirmation).toBeVisible({ timeout: 20000 });
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1].sessionId).toBe(chatRequests[0].sessionId);
    expect(chatRequests[1].prompt[0].text).toContain("e2e-cluster");
    expect(chatRequests[1].prompt[0].text).toContain('"replicas": "5"');
  });

  test("Flow 3: Agent calls studio-ui render_editorial_diagram -> renders EditorialDiagramCard -> displays sequence diagram SVG", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请绘制微服务调用链路时序流程图");
    await composerInput.press("Enter");

    // 1. Verify EditorialDiagramCard title is rendered
    const diagramTitle = page.getByText("微服务调用链路时序图");
    await expect(diagramTitle).toBeVisible({ timeout: 20000 });

    // 2. Verify sequence diagram badge & participants / labels
    const sequenceTag = page.getByText("交互时序图");
    await expect(sequenceTag).toBeVisible();

    const stepLabel = page.getByText("POST /login");
    await expect(stepLabel).toBeVisible();

    // 3. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP render_editorial_diagram 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 4: Agent calls studio-ui render_react_sandbox -> renders ReactArtifactCard -> displays live sandbox preview and tab switching", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请生成一个实时计数器自由组件沙箱");
    await composerInput.press("Enter");

    // 1. Verify ReactArtifactCard title is rendered
    const artifactTitle = page.getByText("实时计数器原型");
    await expect(artifactTitle).toBeVisible({ timeout: 20000 });

    const reactBadge = page.getByText("react", { exact: true });
    await expect(reactBadge).toBeVisible();

    // 2. Verify preview tab button & code tab button
    const codeTab = page.locator('button:has-text("代码")');
    await expect(codeTab).toBeVisible();
    await codeTab.click();

    // 3. Verify code view is displayed
    const codeSnippet = page.getByText("function App()");
    await expect(codeSnippet).toBeVisible();

    // 4. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP render_react_sandbox 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 5: Agent calls studio-ui render_editorial_diagram -> renders EditorialDiagramCard -> displays flowchart diagram SVG with nodes, connections and toolbar zoom", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请绘制订单履约业务状态流转流程图");
    await composerInput.press("Enter");

    // 1. Verify EditorialDiagramCard title & flowchart badge
    const diagramTitle = page.getByText("订单履约业务状态流转图", { exact: true });
    await expect(diagramTitle).toBeVisible({ timeout: 20000 });

    const flowchartTag = page.getByText("流程与状态机");
    await expect(flowchartTag).toBeVisible();

    // 2. Verify flowchart step nodes
    const step1 = page.getByText("订单已创建");
    const step2 = page.getByText("在线支付成功");
    const step3 = page.getByText("仓储打包出库");
    const step4 = page.getByText("顺丰冷链配送");

    await expect(step1).toBeVisible();
    await expect(step2).toBeVisible();
    await expect(step3).toBeVisible();
    await expect(step4).toBeVisible();

    // 3. Verify step status / descriptions
    const desc = page.getByText("待买家支付");
    await expect(desc).toBeVisible();

    // 4. Verify flowchart SVG is rendered
    const svgEl = page.locator("svg").filter({ hasText: "订单已创建" });
    await expect(svgEl).toBeVisible();

    // 5. Verify toolbar zoom controls
    const zoomInBtn = page.getByRole("button", { name: "放大", exact: true });
    await expect(zoomInBtn).toBeVisible();
    await zoomInBtn.click();

    const resetZoomBtn = page.locator('button[title="重置缩放"]');
    await expect(resetZoomBtn).toBeVisible();
    await resetZoomBtn.click();
    await expect(resetZoomBtn).not.toBeVisible();

    // 6. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP render_editorial_diagram 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 6: Agent calls studio-ui show_interactive_card (checklist) -> renders ChecklistCard -> user toggles items -> progress updates dynamically", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请展示发布上线前安全门禁检查清单");
    await composerInput.press("Enter");

    // 1. Verify ChecklistCard title & description
    const listTitle = page.getByRole("heading", { name: "系统上线前安全门禁清单", exact: true });
    await expect(listTitle).toBeVisible({ timeout: 20000 });

    const listDesc = page.getByText("生产发布前必须逐项核对确认");
    await expect(listDesc).toBeVisible();

    // 2. Verify initial progress (1 of 3 items checked -> 33%)
    const initialProgress = page.getByText("1 / 3 (33%)");
    await expect(initialProgress).toBeVisible();

    const item1 = page.getByText("数据库快照已完成备份");
    await expect(item1).toBeVisible();

    const item2 = page.getByText("HTTPS 证书有效性校验");
    await expect(item2).toBeVisible();

    // 3. User clicks second item to check it
    await item2.click();

    // 4. Verify progress updates to 2 / 3 (67%)
    const updatedProgress1 = page.getByText("2 / 3 (67%)");
    await expect(updatedProgress1).toBeVisible();

    // 5. User clicks third item
    const item3 = page.getByText("网关 WAF 安全策略启用");
    await item3.click();

    // 6. Verify progress updates to 3 / 3 (100%)
    const updatedProgress2 = page.getByText("3 / 3 (100%)");
    await expect(updatedProgress2).toBeVisible();

    // 7. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP show_interactive_card 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 7: Agent calls studio-ui show_interactive_card (metrics) -> renders MetricsCard -> displays key operational metrics and trends", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请展示微服务核心运行指标监控看板");
    await composerInput.press("Enter");

    // 1. Verify MetricsCard title & description
    const metricsTitle = page.getByRole("heading", { name: "微服务核心运行指标看板", exact: true });
    await expect(metricsTitle).toBeVisible({ timeout: 20000 });

    const metricsDesc = page.getByText("生产集群最近 1 小时关键监控指标汇总");
    await expect(metricsDesc).toBeVisible();

    // 2. Verify metric tiles: labels and values
    const latencyLabel = page.getByText("平均响应时延 P99");
    await expect(latencyLabel).toBeVisible();
    const latencyValue = page.getByText("12.4");
    await expect(latencyValue).toBeVisible();
    const latencyUnit = page.getByText("ms", { exact: true });
    await expect(latencyUnit).toBeVisible();
    const latencyChange = page.getByText("-8.5%");
    await expect(latencyChange).toBeVisible();

    const qpsLabel = page.getByText("QPS 吞吐量");
    await expect(qpsLabel).toBeVisible();
    const qpsValue = page.getByText("85,400");
    await expect(qpsValue).toBeVisible();
    const qpsUnit = page.getByText("req/s");
    await expect(qpsUnit).toBeVisible();
    const qpsChange = page.getByText("+14.2%");
    await expect(qpsChange).toBeVisible();

    const errLabel = page.getByText("错误率 (Error Rate)");
    await expect(errLabel).toBeVisible();
    const errValue = page.getByText("0.01");
    await expect(errValue).toBeVisible();

    // 3. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP show_interactive_card 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 8: Agent calls studio-ui render_editorial_diagram -> renders Architecture Diagram SVG with hierarchical layers and components", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请绘制微服务分层系统架构图");
    await composerInput.press("Enter");

    // 1. Verify EditorialDiagramCard title & architecture badge
    const diagramTitle = page.getByText("微服务分层系统架构图", { exact: true });
    await expect(diagramTitle).toBeVisible({ timeout: 20000 });

    const archTag = page.getByText("系统架构分层");
    await expect(archTag).toBeVisible();

    // 2. Verify layer titles
    const layer1 = page.getByText("接入网关层");
    const layer2 = page.getByText("业务服务层");
    const layer3 = page.getByText("数据持久层");

    await expect(layer1).toBeVisible();
    await expect(layer2).toBeVisible();
    await expect(layer3).toBeVisible();

    // 3. Verify component nodes inside layers
    const kongNode = page.getByText("Kong Gateway");
    const authNode = page.getByText("Auth Service");
    const pgNode = page.getByText("PostgreSQL 主从");

    await expect(kongNode).toBeVisible();
    await expect(authNode).toBeVisible();
    await expect(pgNode).toBeVisible();

    // 4. Verify SVG element exists
    const svgEl = page.locator("svg").filter({ hasText: "Kong Gateway" });
    await expect(svgEl).toBeVisible();

    // 5. Verify real MCP tool execution completion confirmation in chat stream
    const agentReply = page.getByText("真实 MCP render_editorial_diagram 已返回。");
    await expect(agentReply).toBeVisible({ timeout: 20000 });
  });

  test("Flow 9: Interleaved prose + inline placeholder skeleton -> replaces in-place with Flowchart SVG & Interactive DecisionCard -> preserves DOM order & interactive callback", async () => {
    const { page } = launched!;

    await page.waitForLoadState("domcontentloaded");
    const composerInput = page.locator("textarea").first();
    await expect(composerInput).toBeVisible({ timeout: 15000 });

    await composerInput.click();
    await composerInput.fill("请用图文混排的方式展示订单状态流转与架构选型");
    await composerInput.press("Enter");

    // 1. Verify Paragraph 1 and the intermediate inline placeholder skeleton appear during streaming
    const p1 = page.getByText("第一部分：首先为您展示订单履约的核心状态流转图：");
    await expect(p1).toBeVisible({ timeout: 15000 });

    const placeholder = page
      .locator('[data-testid="generative-inline-placeholder"][data-placeholder-kind="diagram"]')
      .filter({ hasText: "正在生成出版级矢量图表…" });
    await expect(placeholder).toBeVisible({ timeout: 10000 });

    // 2. Wait for backend MCP completion -> placeholder transitions in-place to real Flowchart & DecisionCard
    const diagramTitle = page.getByText("订单履约业务状态流转图", { exact: true });
    await expect(diagramTitle).toBeVisible({ timeout: 20000 });
    await expect(placeholder).toHaveCount(0);

    const p2 = page.getByText("第二部分：结合上述状态流转，请在下方交互卡片中确认高可用架构方案：");
    const cardTitle = page.getByRole("heading", { name: "高可用服务架构选型", exact: true });
    const p3 = page.getByText("第三部分：点击上方卡片中的方案即可直接回传您的架构决策。");

    await expect(p2).toBeVisible({ timeout: 20000 });
    await expect(cardTitle).toBeVisible({ timeout: 20000 });
    await expect(p3).toBeVisible({ timeout: 20000 });

    // 3. Verify strict vertical DOM interleaving order inside the prose:
    //    Paragraph 1 -> Flowchart Diagram -> Paragraph 2 -> Interactive DecisionCard -> Paragraph 3
    const p1Box = await p1.boundingBox();
    const diagramBox = await diagramTitle.boundingBox();
    const p2Box = await p2.boundingBox();
    const cardBox = await cardTitle.boundingBox();
    const p3Box = await p3.boundingBox();

    expect(p1Box).not.toBeNull();
    expect(diagramBox).not.toBeNull();
    expect(p2Box).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(p3Box).not.toBeNull();

    expect(p1Box!.y).toBeLessThan(diagramBox!.y);
    expect(diagramBox!.y).toBeLessThan(p2Box!.y);
    expect(p2Box!.y).toBeLessThan(cardBox!.y);
    expect(cardBox!.y).toBeLessThan(p3Box!.y);

    // 4. Verify interactive callback still works when DecisionCard is mounted inline inside prose
    const optionBtn = page.getByText("事件驱动微服务 (Kafka + Go)");
    await expect(optionBtn).toBeVisible();
    await optionBtn.click();

    const followUpAck = page.getByText("【ACP 会话继续执行】已确认收到您选定的方案！");
    await expect(followUpAck).toBeVisible({ timeout: 20000 });
  });
});

