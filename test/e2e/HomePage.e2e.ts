/* eslint jest/expect-expect: off, jest/no-test-callback: off */
import 'testcafe';
import './helpers';

const assertNoConsoleErrors = async (t: any) => {
  const { error } = await t.getBrowserConsoleMessages();
  await t.expect(error).eql([]);
};

fixture`Home Page`.page('../../app/app.html').afterEach(assertNoConsoleErrors);

test(
  'should not have any logs in console of main window',
  assertNoConsoleErrors
);
