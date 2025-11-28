import CryptoKit
import NitroModules

class HybridCactusCrypto: HybridCactusCryptoSpec {
  func uuidv5(namespaceUuid: String, name: String) throws -> Promise<String> {
    return Promise.async {
      guard let ns = UUID(uuidString: namespaceUuid) else {
        throw RuntimeError.error(withMessage: "Invalid namespace UUID")
      }

      var nsBytes = ns.uuid
      var data = withUnsafeBytes(of: &nsBytes) { Data($0) }
      data.append(Data(name.utf8))

      let digest = Insecure.SHA1.hash(data: data)
      var bytes = Data(digest.prefix(16))
      bytes.withUnsafeMutableBytes { raw in
        let b = raw.bindMemory(to: UInt8.self)
        b[6] = (b[6] & 0x0F) | 0x50
        b[8] = (b[8] & 0x3F) | 0x80
      }

      let tuple = bytes.withUnsafeBytes { ptr -> uuid_t in
        let b = ptr.bindMemory(to: UInt8.self)
        return uuid_t(
          b[0], b[1], b[2], b[3],
          b[4], b[5], b[6], b[7],
          b[8], b[9], b[10], b[11],
          b[12], b[13], b[14], b[15])
      }

      let uuid = UUID(uuid: tuple)

      return uuid.uuidString.lowercased()
    }
  }
}
