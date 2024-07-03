import {Lit} from "../src/lit";
import {ethers} from "ethers";
import 'dotenv/config'
const fs = require('fs');


describe("Lit functions", () => {
  let tokenId: string;
  let pkpPubKey: string;
  let ipfsId: string;
  let noWhitelistIPFSID = process.env.MINIMAL_LIT_ACTION_IPFS_ID // IPFS ID of a minimal lit action that signs
  let ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  let litInstance = new Lit(noWhitelistIPFSID, ownerPrivateKey);
  let delegateePrivateKey = process.env.DELEGATEE_PRIVATE_KEY;
  let delegateeWallet = new ethers.Wallet(delegateePrivateKey);
  const pathToLitActionCode = process.env.PATH_TO_LIT_ACTION_CODE || 'src/actions/minimalLitAction.js';
  const litActionCode  = fs.readFileSync(pathToLitActionCode);
  test("should upload lit action to IPFS", () => {
    return litInstance.uploadLitActionToIPFS(litActionCode.toString()).then((res) => {
      expect(typeof res).toBe('string')
      ipfsId = res;
    })
  });
  test("should set new lit action in lit instance", () => {
    litInstance.setLitActionIPFSID(ipfsId)
    expect(litInstance.lit_action_ipfs_id).toEqual(ipfsId)
  });
  test("mint PKP with new IPFS", () => {
    return litInstance.mintPKP(delegateeWallet.address).then((res) => {
      expect(res.error).toEqual(undefined)
      expect(typeof res.tokenId).toBe('string')
      tokenId = res.tokenId
      expect(typeof res.pkpPubKey).toBe('string')
      pkpPubKey = res.pkpPubKey
    }).catch((e) => {
      console.error(e)
    })
  }, 30 * 1000); // time out of 30 seconds
  test("Sign transaction with fields that are in the whitelist", () => {
    const unsignedTx = {
      chainId: 1n, //base
      gasPrice: 61416194n,
      nonce: 1,
      from: '0x',
      to: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', //DAI in base chain
      data: '0x'
    }

    return litInstance.signTX(pkpPubKey, tokenId, delegateePrivateKey, unsignedTx).then((res) => {
      console.log(res)
      expect(res).toBeDefined()
    }).catch((e) => {
      console.error(e)
    })
  }, 30 * 1000); // time out of 30 seconds
});
