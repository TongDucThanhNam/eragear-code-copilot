export const TMPFS_SUPER_MAGIC = 0x1_02_19_94;
export const ZFS_SUPER_MAGIC = 0x2f_c1_2f_c1;
export const JFS_SUPER_MAGIC = 0x31_53_46_4a;
export const REISERFS_SUPER_MAGIC = 0x52_65_49_73;
export const XFS_SUPER_MAGIC = 0x58_46_53_42;
export const BTRFS_SUPER_MAGIC = 0x91_23_68_3e;
export const EXT_SUPER_MAGIC = 0xef_53;

export const HFS_PLUS_SUPER_MAGIC = 0x1a;
export const APFS_SUPER_MAGIC = 0x1c;

export const SMB_SUPER_MAGIC = 0x51_7b;
export const NFS_SUPER_MAGIC = 0x69_69;
export const AFS_SUPER_MAGIC = 0x53_46_41_4f;
export const CIFS_SUPER_MAGIC = 0xff_53_4d_42;

export const WINDOWS_UNC_PATH_PREFIX = "\\\\";

export const LINUX_LOCAL_FS_TYPES = new Set<number>([
  TMPFS_SUPER_MAGIC,
  ZFS_SUPER_MAGIC,
  JFS_SUPER_MAGIC,
  REISERFS_SUPER_MAGIC,
  XFS_SUPER_MAGIC,
  BTRFS_SUPER_MAGIC,
  EXT_SUPER_MAGIC,
]);

export const MACOS_LOCAL_FS_TYPES = new Set<number>([
  HFS_PLUS_SUPER_MAGIC,
  APFS_SUPER_MAGIC,
]);

export const WINDOWS_LOCAL_FS_TYPES = new Set<number>();

export const KNOWN_NETWORK_FS_TYPES = new Set<number>([
  SMB_SUPER_MAGIC,
  NFS_SUPER_MAGIC,
  AFS_SUPER_MAGIC,
  CIFS_SUPER_MAGIC,
]);

export const STORAGE_LOCAL_FS_TYPES: Partial<
  Record<NodeJS.Platform, Set<number>>
> = {
  linux: LINUX_LOCAL_FS_TYPES,
  darwin: MACOS_LOCAL_FS_TYPES,
  win32: WINDOWS_LOCAL_FS_TYPES,
};
