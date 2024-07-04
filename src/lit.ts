import { LitContracts } from "@lit-protocol/contracts-sdk";
import * as LitJsSdk from "@lit-protocol/lit-node-client";
import { getWalletSessionSigs } from "./getWalletSessionSigs";
import { ethers, utils, BigNumber } from "ethers";
import { serialize, recoverAddress } from "@ethersproject/transactions";
import {
  hexlify,
  splitSignature,
  hexZeroPad,
  joinSignature,
} from "@ethersproject/bytes";
import { recoverPublicKey, computePublicKey } from "@ethersproject/signing-key";
import { AuthMethodType, AuthMethodScope } from "@lit-protocol/constants";
import { keccak256 } from "js-sha3";
import { LIT_NETWORKS_KEYS } from "@lit-protocol/types";

require("dotenv").config();

type mintRes = {
  pkp: {
    tokenId: string;
    publicKey: string;
    ethAddress: string;
  };
  tx: ethers.providers.TransactionResponse;
  tokenId: any;
  res: any;
};

export class Lit {
  lit_action_ipfs_id: string;
  private_key: string;
  lit_network: LIT_NETWORKS_KEYS;
  lit_chain_id: number;
  constructor(lit_action_ipfs_id: string, private_key: string) {
    this.lit_action_ipfs_id = lit_action_ipfs_id;
    this.private_key = private_key;
    this.lit_network = "cayenne";
    //@todo: what  should this chainId be?
    this.lit_chain_id = 175177;
  }

  setLitActionIPFSID(lit_action_ipfs_id: string) {
    this.lit_action_ipfs_id = lit_action_ipfs_id;
  }

  async uploadLitActionToIPFS(code: any): Promise<string> {
    const res = await fetch(
      "https://explorer.litprotocol.com/api/pinata/upload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      }
    );
    const ipfsData = await res.json();
    console.log("ipfsData:", ipfsData);
    return ipfsData.IpfsHash;
  }

  async mintPKP(delegateeAddress: string) {
    const wallet = new ethers.Wallet(this.private_key);
    const PUBLIC_KEY: string = wallet.address;

    // CONNECT TO NODES
    console.log("Connecting to nodes...");
    const litNodeClient = new LitJsSdk.LitNodeClient({
      alertWhenUnauthorized: false,
      minNodeCount: 1,
      litNetwork: this.lit_network,
      debug: false,
    });
    await litNodeClient.connect();

    // CONNECT TO CONTRACTS
    console.log("Connecting to contracts...");
    const litContracts = new LitContracts({
      privateKey: this.private_key,
    });
    await litContracts.connect();

    // MINT THE PKP
    console.log("Starting minting...");
    let tokenId, pkpPubKey;
    const mintCost = await litContracts.pkpNftContract.read.mintCost();
    try {
      const keyType = 2;
      const permittedAuthMethodTypes = [AuthMethodType.LitAction];
      console.log("lit action ipfs id used: ", this.lit_action_ipfs_id);
      console.log(
        "what that will look like inside the NFT: ",
        litContracts.utils.getBytesFromMultihash(this.lit_action_ipfs_id)
      );
      const permittedAuthMethodIds = [
        litContracts.utils.getBytesFromMultihash(this.lit_action_ipfs_id),
      ];
      const permittedAuthMethodPubkeys = [delegateeAddress];
      const permittedAuthMethodScopes = [[AuthMethodScope.SignAnything]];
      const mintTx =
        await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
          keyType,
          permittedAuthMethodTypes,
          permittedAuthMethodIds,
          permittedAuthMethodPubkeys,
          permittedAuthMethodScopes,
          true,
          true,
          {
            value: mintCost,
            gasPrice: ethers.utils.parseUnits("0.001", "gwei"),
            gasLimit: 2000000,
          }
        );
      const mintTxReceipt = await mintTx.wait();

      tokenId = mintTxReceipt?.events
        ? mintTxReceipt?.events[0].topics[1]
        : undefined;
      console.log("Minted token id: ", tokenId);
      pkpPubKey = await litContracts.pkpPermissionsContract.read.getPubkey(
        tokenId!
      );
      console.log("Minted pkpPubKey: ", pkpPubKey);
      return {
        tokenId,
        pkpPubKey,
      };
    } catch (e: any) {
      console.error(e);
      return {
        tokenId: undefined,
        pkpPubKey: undefined,
        error: e,
      };
    }
  }

  // delegateePrivateKey: the private key of the address that is signing the payload so the pkp can authenticate
  // tx: payload to be signed
  // pkpPubKey and pkpTokenId: are fields related to the pkp
  async signTX(
    pkpPubKey: string,
    pkpTokenId: string,
    delegateePrivateKey: string,
    tx: any
  ): Promise<any> {
    const delegateeWallet = new ethers.Wallet(delegateePrivateKey);
    console.log(
      `Using pkpPubKey ${pkpPubKey}, pkpTokenId ${pkpTokenId}, delegateeAddress: ${delegateeWallet.address}`
    );

    delete tx["gasPrice"];
    tx.maxFeePerGas = 3000000000;
    tx.maxPriorityFeePerGas = 300000000;
    tx.type = 2;

    console.log("tx transformed to type 2", tx);
    let unsignedTxn: any = null;
    try {
      console.log("Serializing transaction...");
      let serializedTx = serialize(tx);
      console.log("serializedTx", serializedTx);

      const rlpEncodedTxn = ethers.utils.arrayify(serializedTx);
      console.log("rlpEncodedTxn: ", rlpEncodedTxn);

      unsignedTxn = keccak256.digest(rlpEncodedTxn);
      console.log("unsignedTxn: ", unsignedTxn);
    } catch (error) {
      console.error("Failed to serialize transaction:", error);
    }

    const messageToSign = unsignedTxn;
    console.log("messageToSign: ", messageToSign);

    // Get the sessionSigs for the delegatee wallet
    const sessionSigs = await getWalletSessionSigs(
      {
        privateKey: this.private_key,
        chainId: this.lit_chain_id,
        litActionCid: this.lit_action_ipfs_id,
      },
      this.lit_network
    );

    // Connect to node
    try {
      console.log("Connecting to nodes...");
      const litNodeClient = new LitJsSdk.LitNodeClient({
        alertWhenUnauthorized: false,
        litNetwork: this.lit_network,
        debug: false,
        minNodeCount: 1,
      });
      await litNodeClient.connect();
      // Connect to contracts
      console.log("Connecting to contracts...");
      const litContracts = new LitContracts({
        privateKey: delegateeWallet.privateKey.substring(2),
      });
      await litContracts.connect();
      // Execute the lit action attached to the PKP to get the signature
      console.log("Using the lit action to sign the transaction...");
      const executeJSPayload = {
        ipfsId: this.lit_action_ipfs_id,
        sessionSigs,
        jsParams: {
          txParams: JSON.stringify(unsignedTxn),
          toSign: JSON.stringify(messageToSign),
          publicKey: pkpPubKey,
          sigName: "sig1",
          tokenId: pkpTokenId,
          authMethodType: AuthMethodType.LitAction,
          userId: litContracts.utils.getBytesFromMultihash(
            this.lit_action_ipfs_id
          ),
        },
      };
      //@ts-ignore
      const results = await litNodeClient.executeJs(executeJSPayload);
      console.log("Results from Lit action: ", results);
      const { signatures } = results;
      const signature = signatures.sig1;
      let { dataSigned } = signature;
      dataSigned = "0x" + dataSigned;
      const encodedSig = joinSignature({
        r: "0x" + signature.r,
        s: "0x" + signature.s,
        v: signature.recid,
      });
      let txToSerialize = tx;
      console.log("txToSerialize", txToSerialize);
      const serializedTx = serialize(txToSerialize, encodedSig);
      console.log("serializedTx", serializedTx);
      try {
        const tx = ethers.utils.parseTransaction(serializedTx);
        console.log(tx);
      } catch (error) {
        console.error("Failed to parse transaction:", error);
      }
      return serializedTx;
    } catch (e: any) {
      console.error(e);
      return;
    }
  }
}
