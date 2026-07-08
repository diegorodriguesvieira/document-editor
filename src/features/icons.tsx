import AddCommentOutlined from '@mui/icons-material/AddCommentOutlined'
import AlternateEmail from '@mui/icons-material/AlternateEmail'
import CallSplit from '@mui/icons-material/CallSplit'
import Code from '@mui/icons-material/Code'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import FormatBold from '@mui/icons-material/FormatBold'
import FormatItalic from '@mui/icons-material/FormatItalic'
import FormatListBulleted from '@mui/icons-material/FormatListBulleted'
import FormatListNumbered from '@mui/icons-material/FormatListNumbered'
import FormatQuote from '@mui/icons-material/FormatQuote'
import GridOn from '@mui/icons-material/GridOn'
import HorizontalRule from '@mui/icons-material/HorizontalRule'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined'
import LinkIcon from '@mui/icons-material/Link'
import Redo from '@mui/icons-material/Redo'
import Undo from '@mui/icons-material/Undo'
import ViewColumn from '@mui/icons-material/ViewColumn'

/**
 * The SDK defaults' icon set, prebuilt as elements so plain .ts feature files
 * can use them without JSX. `ToolbarItem.icon` accepts any ReactNode — a
 * consumer feature can pass its own elements or keep short strings ('H1').
 */
export const icons = {
  bold: <FormatBold />,
  italic: <FormatItalic />,
  link: <LinkIcon />,
  bulletList: <FormatListBulleted />,
  orderedList: <FormatListNumbered />,
  quote: <FormatQuote />,
  code: <Code />,
  divider: <HorizontalRule />,
  image: <ImageOutlined />,
  table: <GridOn />,
  tableColumns: <ViewColumn />,
  comment: <AddCommentOutlined />,
  conditional: <CallSplit />,
  callout: <LightbulbOutlined />,
  mergeField: <AlternateEmail />,
  undo: <Undo />,
  redo: <Redo />,
  delete: <DeleteOutline />,
} as const
