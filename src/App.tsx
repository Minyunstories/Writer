import { Route, Routes } from 'react-router-dom'
import { BookView } from './book/BookView'
import { Dashboard } from './dashboard/Dashboard'
import { Editor } from './editor/Editor'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/book/:bookId/:section?/:itemId?" element={
          <BookView
            renderChapter={({ book, chapter, onChanged, extensions }) => (
              <Editor
                key={chapter.id}
                book={book}
                chapter={chapter}
                onChanged={onChanged}
                extraExtensions={extensions}
              />
            )}
          />
        } />
    </Routes>
  )
}
