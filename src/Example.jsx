/*
 * Copyright 2026 Justlend V2 Utils. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React, { useEffect } from "react";
import { useWallet } from "@tronweb3/tronwallet-adapter-react-hooks";
// import { depositToVault, approve, getAllowance } from "./utils/systemV2";
// import { tronObj } from "./utils/blockchain";
import { depositToVault, approve, getAllowance, tronObj } from "justlend-v2-utils";
import BigNumber from "bignumber.js";
import { message } from "antd";

// Configuration Constants
const vaultAddress = "THwTBAmVoZTp4NY6HxJUHGDFGerDn9vuEW"; 
const assetAddress = "TPYwAC9Y4uUcT2QH3WPPjqxzJSJWymMoMS"; 
const inputAmount = "1"; 
const assetDecimal = 6; 
const amountInChain = new BigNumber(inputAmount).times(10 ** assetDecimal);

function Example() {
  const { connect, disconnect, select, address, connected, wallet } = useWallet();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (address) {
      console.log("Connected Address:", address);
      window.defaultAccount = address;
      tronObj.tronWeb = window.tronWeb;
    }
  }, [address]);

  const handleTestDeposit = async () => {
    const allowance = await getAllowance(assetAddress, address, vaultAddress);
    if (allowance.lt(amountInChain)) {
      try {
        const res = await approve(assetAddress, vaultAddress, { unlimited: true });
        console.log("Approve Response", res);
        messageApi.success({
          content: `Approve Successful! txID: ${res?.transaction?.txID}`,
          duration: 2,
        });
      } catch (err) {
        messageApi.error(`Transaction Failed: ${err.message || "Unknown Error"}`);
      }
    }

    try {
      const res = await depositToVault(
        vaultAddress,
        inputAmount,
        assetDecimal,
        address,
      );
      console.log("Deposit Response", res);
      messageApi.success({
        content: `Deposit Successful! txID: ${res?.transaction?.txID}`,
        duration: 2,
      });
    } catch (err) {
      messageApi.error(`Transaction Failed: ${err.message || "Unknown Error"}`);
    }
  };

  const handleConnect = async () => {
    try {
      if (!wallet || wallet.adapter.name !== "TronLink") {
        select("TronLink");
        return;
      }
      await connect();
    } catch (e) {
      console.error("Connection Error", e);
    }
  };

  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <h2>JustLend V2 Utils Test Case</h2>
      <p>Please use Nile testnet for testing</p>

      {!connected ? (
        <button onClick={handleConnect}>Connect TronLink</button>
      ) : (
        <div>
          <p>
            Current Wallet: <code>{address}</code>
          </p>
          <button onClick={() => disconnect()}>Disconnect</button>
          <br />
          <div style={{ 
            width:'500px',
            margin:"20px auto 0",
            textAlign: "left", 
            backgroundColor: "#f8f9fa", 
            padding: "15px", 
            borderRadius: "8px", 
            border: "1px solid #dee2e6",
            fontSize: "13px",
            lineHeight: "1.6"
          }}>
            <h4 style={{ margin: "0 0 10px 0", color: "#333" }}>Configuration Constants</h4>
            <div style={{ marginBottom: "4px" }}><strong>Vault Address:</strong> <code style={codeStyle}>{vaultAddress}</code></div>
            <div style={{ marginBottom: "4px" }}><strong>Asset Address:</strong> <code style={codeStyle}>{assetAddress}</code></div>
            <div style={{ marginBottom: "4px" }}><strong>Input Amount:</strong> <code>{inputAmount}</code></div>
            <div style={{ marginBottom: "4px" }}><strong>Asset Decimal:</strong> <code>{assetDecimal}</code></div>
          </div>
          <br />
          <button
            style={{ padding: "10px 20px", background: "#f00", color: "#fff" ,border:'none',cursor:'pointer'}}
            onClick={handleTestDeposit}
          >
            Test Contract Deposit
          </button>
        </div>
      )}
      {contextHolder}
    </div>
  );
}

const codeStyle = {
  backgroundColor: "#e9ecef",
  padding: "2px 4px",
  borderRadius: "3px",
  wordBreak: "break-all"
};

export default Example;
