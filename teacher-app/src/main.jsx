import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'
import { NotificationProvider } from './components/NotificationToast.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NotificationProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </NotificationProvider>
  </React.StrictMode>,
)
