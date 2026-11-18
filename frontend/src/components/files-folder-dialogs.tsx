import type { RefObject } from 'react'
import { FormDialog, inputClass } from './form-dialog'

const FOLDER_NAME_MAX = 80

type NewFolderDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  onCreate: (name: string) => void
}

export function NewFolderDialog({ dialogRef, onCreate }: NewFolderDialogProps) {
  return (
    <FormDialog
      dialogRef={dialogRef}
      title="New folder"
      description="Keep related designs together. Drag files onto a folder to move them."
      submitLabel="Create folder"
      busy={false}
      error={null}
      onSubmit={(form, formEl) => {
        const name = String(form.get('name') ?? '').trim()
        if (!name) return
        formEl.reset()
        dialogRef.current?.close()
        onCreate(name)
      }}
    >
      <input
        name="name"
        required
        maxLength={FOLDER_NAME_MAX}
        aria-label="Folder name"
        placeholder="Folder name"
        className={inputClass}
      />
    </FormDialog>
  )
}

type MoveToFolderDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  count: number
  folders: string[]
  /** `null` = top level. */
  onMove: (folder: string | null) => void
}

export function MoveToFolderDialog({ dialogRef, count, folders, onMove }: MoveToFolderDialogProps) {
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={count === 1 ? 'Move file' : `Move ${count} files`}
      description="Choose a folder, or type the name of a new one."
      submitLabel="Move"
      busy={false}
      error={null}
      onSubmit={(form, formEl) => {
        const typed = String(form.get('newFolder') ?? '').trim()
        const picked = String(form.get('folder') ?? '')
        formEl.reset()
        dialogRef.current?.close()
        onMove(typed || picked || null)
      }}
    >
      <select name="folder" aria-label="Folder" defaultValue="" className={inputClass}>
        <option value="">No folder (top level)</option>
        {folders.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <input
        name="newFolder"
        maxLength={FOLDER_NAME_MAX}
        aria-label="New folder name"
        placeholder="Or a new folder name"
        className={inputClass}
      />
    </FormDialog>
  )
}
