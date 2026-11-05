import { useCallback } from "react"
import { Plus, Search } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "../../ui/button"
import { useQuickSwitcherStore } from "../../../stores/quickSwitcherStore"

interface Props {
  onClose: () => void
}

export function SidebarMobileActions({ onClose }: Props) {
  const navigate = useNavigate()
  const openSwitcher = useQuickSwitcherStore((s) => s.openSwitcher)
  const handleSearch = useCallback(() => {
    onClose()
    openSwitcher()
  }, [onClose, openSwitcher])
  const handleNewProject = useCallback(() => {
    navigate("/")
    onClose()
  }, [navigate, onClose])

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSearch}
        className="size-10 rounded-lg hover:!border-border/0 md:hidden"
        aria-label="Search projects"
      >
        <Search className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNewProject}
        className="size-10 rounded-lg hover:!border-border/0 md:hidden"
        title="New project"
        aria-label="New project"
      >
        <Plus className="h-5 w-5" />
      </Button>
    </>
  )
}
