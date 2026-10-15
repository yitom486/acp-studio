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
});
