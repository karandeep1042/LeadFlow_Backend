import assert from 'node:assert';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';
import { generateAccessToken, verifyAccessToken } from '../utils/jwt.js';

async function runTests() {
  console.log('--- Running Multi-Workspace Architecture Tests ---');

  // Test 1: JWT Scoped Token Generation & Verification
  const mockUser = {
    _id: new mongoose.Types.ObjectId(),
    email: 'multiuser@leadflow.de',
    role: 'advisor',
    brokerageId: new mongoose.Types.ObjectId(),
  };

  const scopedWorkspace1 = {
    brokerageId: new mongoose.Types.ObjectId().toString(),
    role: 'brokerage_admin',
  };

  const scopedWorkspace2 = {
    brokerageId: new mongoose.Types.ObjectId().toString(),
    role: 'advisor',
  };

  const tokenAdmin = generateAccessToken(mockUser, scopedWorkspace1);
  const decodedAdmin = verifyAccessToken(tokenAdmin);
  assert.strictEqual(decodedAdmin.role, 'brokerage_admin', 'Token 1 should be scoped as brokerage_admin');
  assert.strictEqual(decodedAdmin.brokerageId, scopedWorkspace1.brokerageId, 'Token 1 brokerageId mismatch');

  const tokenAdvisor = generateAccessToken(mockUser, scopedWorkspace2);
  const decodedAdvisor = verifyAccessToken(tokenAdvisor);
  assert.strictEqual(decodedAdvisor.role, 'advisor', 'Token 2 should be scoped as advisor');
  assert.strictEqual(decodedAdvisor.brokerageId, scopedWorkspace2.brokerageId, 'Token 2 brokerageId mismatch');

  console.log('✓ Test 1 Passed: JWT scoping generates distinct role/tenant identities for the same user account.');

  // Test 2: User schema getWorkspaces logic
  const mockBrokerageId1 = new mongoose.Types.ObjectId();
  const mockBrokerageId2 = new mongoose.Types.ObjectId();

  const userDoc = new User({
    name: 'Multi Role User',
    email: 'test@example.com',
    password: 'Password@123',
    role: 'advisor',
    brokerageId: mockBrokerageId1,
    memberships: [
      {
        brokerageId: mockBrokerageId1,
        role: 'advisor',
        status: 'active',
      },
      {
        brokerageId: mockBrokerageId2,
        role: 'brokerage_admin',
        status: 'active',
      },
      {
        brokerageId: null,
        role: 'platform_admin',
        status: 'active',
      },
      {
        brokerageId: new mongoose.Types.ObjectId(),
        role: 'advisor',
        status: 'suspended', // should be excluded
      },
    ],
  });

  const workspaces = await userDoc.getWorkspaces();
  assert.strictEqual(workspaces.length, 3, 'Should only return 3 active workspaces (suspended excluded)');
  
  const platformAdminWs = workspaces.find((w) => w.role === 'platform_admin');
  assert(platformAdminWs, 'Platform admin workspace should be present');
  assert.strictEqual(platformAdminWs.brokerageName, 'Global SaaS Platform');

  const advisorWs = workspaces.find((w) => w.role === 'advisor');
  assert(advisorWs, 'Advisor workspace should be present');
  assert.strictEqual(advisorWs.brokerageId, mockBrokerageId1.toString());

  const adminWs = workspaces.find((w) => w.role === 'brokerage_admin');
  assert(adminWs, 'Brokerage Admin workspace should be present');
  assert.strictEqual(adminWs.brokerageId, mockBrokerageId2.toString());

  console.log('✓ Test 2 Passed: User.getWorkspaces() accurately maps multi-tenant memberships and filters suspended ones.');

  console.log('\nAll Multi-Workspace Unit Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});