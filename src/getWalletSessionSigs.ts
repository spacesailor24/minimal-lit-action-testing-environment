//NEW METHOD DO GET SESSION SIGS
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import { LitNodeClient } from '@lit-protocol/lit-node-client';
import { LitAbility } from '@lit-protocol/types';
import { LitAccessControlConditionResource, LitActionResource, LitPKPResource, createSiweMessageWithRecaps, generateAuthSig, newSessionCapabilityObject } from "@lit-protocol/auth-helpers";
import {LIT_NETWORKS_KEYS} from '@lit-protocol/types';
interface AuthSigProp {
  privateKey: string;
  chainId: number;
  litActionCid: string;
}

export const getWalletSessionSigs = async (prop: AuthSigProp, litNetwork: LIT_NETWORKS_KEYS) => {
  let { privateKey, chainId } = prop;
  const wallet = new ethers.Wallet(privateKey);


  const litNodeClient = new LitNodeClient({
    litNetwork: litNetwork,
    debug: true,
  });

  await litNodeClient.connect();

  const nonce = await litNodeClient.getLatestBlockhash();

  const authNeededCallback = async ({ resourceAbilityRequests, expiration, uri }) => {
    const toSign = await createSiweMessageWithRecaps({
      uri,
      expiration,
      resources: resourceAbilityRequests,
      walletAddress: wallet.address,
      nonce,
      litNodeClient,
    });

    return await generateAuthSig({
      signer: wallet,
      toSign,
    });
  };

  // @todo: need to check whether the LitAbility.PKPSigning capability is the best one for scoping
  // https://developer.litprotocol.com/sdk/authentication/session-sigs/capability-objects
  const sessionSigs = await litNodeClient.getSessionSigs({
    chain: "ethereum",
    expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
    resourceAbilityRequests: [
      {
        resource: new LitActionResource("*"),
        ability: LitAbility.LitActionExecution,
      },
    ],
    // @ts-ignore
    authNeededCallback,
  });

  return sessionSigs;
};