import ECPair, { Options } from '@nervosnetwork/ckb-sdk-utils/lib/ecpair'
import RPC from '@nervosnetwork/ckb-sdk-rpc'
import { hexToBytes, bytesToHex, lockScriptToHash } from '@nervosnetwork/ckb-sdk-utils'

const BasicCapacityUnit: CKBComponents.CapacityUnit.Byte = 10 ** 8

class Account extends ECPair {
  public static MIN_CELL_CAPACITY = 10 * BasicCapacityUnit

  public rpc: RPC

  public unlockArgs: string[] = []

  public lockScript: CKBComponents.Script = {
    codeHash: '',
    args: [],
  }

  public contractScript: CKBComponents.Script = {
    codeHash: '',
    args: [],
  }

  get lockHash(): string {
    return lockScriptToHash(this.lockScript)
  }

  get contractHash(): string {
    return lockScriptToHash(this.contractScript)
  }

  get address() {
    return this.lockHash
  }

  public deps: CKBComponents.OutPoint[] = []

  public constructor(sk: Uint8Array | string, rpc: RPC, options?: Options) {
    super(typeof sk === 'string' ? hexToBytes(sk) : sk, options)
    this.rpc = rpc
  }

  public get hexPubKey(): string {
    return bytesToHex(this.publicKey)
  }

  // =========================

  getUnspentCells = async () => {
    // TODO: in the ruby sdk demo,
    // it iterates all block to gather cells,
    // however only P1CS needs to be covered, TBD
    const to = await this.rpc.getTipBlockNumber()
    const cells = await this.rpc.getCellsByLockHash(`0x${this.lockHash}`, '0', to)
    return cells
  }

  getBalance = async (): Promise<string> =>
    this.getUnspentCells().then(cells => cells.reduce((a, c) => a + BigInt(c.capacity), BigInt(0)).toString())

  // ========================================

  gatherInputs = async (
    capacityStr: CKBComponents.Capacity,
    minCapacityStr: CKBComponents.Capacity,
    since: CKBComponents.Since = '0'
  ) => {
    const capacity = BigInt(capacityStr)
    const minCapacity = BigInt(minCapacityStr)
    if (capacity < minCapacity) {
      throw new Error(`Capacity cannot less than ${minCapacity}`)
    }
    let inputCapacities = BigInt(0)
    const inputs: CKBComponents.CellInput[] = []
    await this.getUnspentCells().then(cells =>
      cells.every(cell => {
        const input: CKBComponents.CellInput = {
          previousOutput: cell.outPoint,
          args: this.unlockArgs,
          since,
        }
        inputs.push(input)
        inputCapacities += BigInt(cell.capacity)
        if (inputCapacities >= capacity && inputCapacities - capacity >= minCapacity) {
          return false
        }
        return true
      }))

    if (inputCapacities < capacity) {
      throw new Error(`Not enough capacity, required: ${capacity}, available: ${inputCapacities}`)
    }
    return {
      inputs,
      capacity: inputCapacities.toString(),
    }
  }

  generateTx = async (
    targetLock: CKBComponents.Script,
    targetCapacityStr: CKBComponents.Capacity,
    witnesses: CKBComponents.Witness[] = []
  ): Promise<CKBComponents.RawTransaction> => {
    const { inputs, capacity: capacityStr } = await this.gatherInputs(targetCapacityStr, `${Account.MIN_CELL_CAPACITY}`)
    const outputs: CKBComponents.CellOutput[] = [
      {
        capacity: targetCapacityStr,
        data: '',
        lock: targetLock,
      },
    ]
    const capacity = BigInt(capacityStr)
    const targetCapacity = BigInt(targetCapacityStr)
    if (capacity > targetCapacity) {
      outputs.push({
        capacity: (capacity - targetCapacity).toString(),
        data: '',
        lock: this.lockScript,
      })
    }
    const tx = {
      version: 0,
      deps: this.deps,
      inputs,
      outputs,
      witnesses,
    }
    return tx
  }

  sendCapacity = async (targetLock: CKBComponents.Script, capacity: CKBComponents.Capacity) => {
    const tx = await this.generateTx(targetLock, capacity)
    return this.rpc.sendTransaction(tx)
  }
}

export default Account
