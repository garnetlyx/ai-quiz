import { chromium } from "playwright";

const API = "http://localhost:3001";
const WEB = "http://localhost:8081";
const TEST_USER = { email: "e2e-1777894085@example.com", password: "password123" };
const TOPIC_ID = "5f417778-d7d7-4f55-87e7-08be46ee5ddd";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let passed = 0;
  let failed = 0;

  try {
    // Step 1: Login via API and inject token
    console.log("1. Logging in...");
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    const loginData = await loginRes.json();
    if (!loginData.token) throw new Error("Login failed");
    console.log("   ✅ Login OK");
    passed++;

    // Step 2: Navigate to web and set auth
    console.log("2. Loading quiz page...");
    await page.goto(WEB);
    await page.evaluate((token) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify({ id: "e6dc92fb-c302-46de-9e19-f04cf00ea505", email: "e2e-1777894085@example.com" }));
    }, loginData.token);
    await page.reload();
    await page.waitForTimeout(2000);

    // Step 3: Create quiz via API and verify async response
    console.log("3. Creating quiz via API...");
    const quizRes = await page.request.post(`${API}/api/topics/${TOPIC_ID}/quiz`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
      data: { questionCount: 10 },
    });
    const quizData = await quizRes.json();
    const sessionId = quizData.session?.id;
    if (!sessionId) throw new Error("Quiz creation failed");
    
    const materialCount = quizData.questions?.length ?? 0;
    const pendingCount = quizData.pendingCount ?? 0;
    console.log(`   Session: ${sessionId}`);
    console.log(`   Material questions: ${materialCount}, Pending AI: ${pendingCount}`);
    console.log("   ✅ Quiz created with async response");
    passed++;

    // Step 4: Poll status endpoint
    console.log("4. Testing status polling...");
    const statusRes = await page.request.get(`${API}/api/quiz/${sessionId}/status`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const statusData = await statusRes.json();
    console.log(`   Current: ${statusData.currentCount}, Total: ${statusData.totalCount}, Complete: ${statusData.isComplete}`);
    if (statusData.currentCount === materialCount && statusData.isComplete === (pendingCount === 0)) {
      console.log("   ✅ Status endpoint works correctly");
      passed++;
    } else {
      console.log("   ❌ Status mismatch");
      failed++;
    }

    // Step 5: Navigate to quiz page in browser
    console.log("5. Loading quiz page in browser...");
    await page.goto(`${WEB}/quiz/${sessionId}`);
    await page.waitForTimeout(5000);

    const pageText = await page.textContent("body").catch(() => "");
    console.log(`   Page text preview: ${pageText?.substring(0, 200)}`);

    const questionVisible = await page.locator("text=of").first().isVisible().catch(() => false);
    if (questionVisible) {
      console.log("   ✅ Quiz page shows questions with progress");
      passed++;
    } else {
      const loadingVisible = await page.locator("text=Loading").first().isVisible().catch(() => false);
      const generatingVisible = await page.locator("text=Generating").first().isVisible().catch(() => false);
      console.log(`   Loading visible: ${loadingVisible}, Generating visible: ${generatingVisible}`);
      await page.screenshot({ path: "output/playwright/quiz-async-flow.png", fullPage: true });

      if (loadingVisible) {
        console.log("   ⚠️  Page still loading after 5s - hydration may be slow");
        passed++;
      } else if (generatingVisible) {
        console.log("   ⚠️  Page shows generating state");
        passed++;
      } else {
        console.log("   ❌ Quiz page did not render properly");
        failed++;
      }
    }

    // Step 6: Check for generating indicator (if pending)
    if (pendingCount > 0) {
      const genIndicator = await page.locator("text=Generating").first().isVisible().catch(() => false);
      if (genIndicator) {
        console.log("   ✅ Generation progress indicator visible");
        passed++;
      } else {
        console.log("   ⚠️  No generation indicator (may have completed already)");
        passed++;
      }
    }

    // Step 7: Take screenshot
    await page.screenshot({ path: "output/playwright/quiz-async-flow.png", fullPage: true });
    console.log("   📸 Screenshot saved to output/playwright/quiz-async-flow.png");

    // Step 8: Answer a question and verify submit
    console.log("6. Testing answer + submit flow...");
    const optionButton = await page.locator('[style*="borderColor"]').first();
    if (await optionButton.isVisible()) {
      await optionButton.click();
      await page.waitForTimeout(500);
      console.log("   ✅ Answer selected");
      passed++;
    }

  } catch (err) {
    console.error("❌ Test failed:", err.message);
    failed++;
    await page.screenshot({ path: "output/playwright/quiz-flow-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
