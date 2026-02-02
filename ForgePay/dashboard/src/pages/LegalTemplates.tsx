import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { FileText, Plus, Edit, Check, History, Trash2, X, ExternalLink } from 'lucide-react'

type LegalTemplateType = 'terms_of_service' | 'privacy_policy' | 'refund_policy'

interface LegalTemplate {
  id: string
  type: LegalTemplateType
  version: number
  title: string
  content?: string
  language: string
  isActive: boolean
  isDefault: boolean
  effectiveDate: string | null
  createdAt: string
  updatedAt: string
}

const TYPE_LABELS: Record<LegalTemplateType, { en: string; zh: string }> = {
  terms_of_service: { en: 'Terms of Service', zh: '服务条款' },
  privacy_policy: { en: 'Privacy Policy', zh: '隐私政策' },
  refund_policy: { en: 'Refund Policy', zh: '退款政策' },
}

export function LegalTemplates() {
  const [selectedType, setSelectedType] = useState<LegalTemplateType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<LegalTemplate | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['legalTemplates'],
    queryFn: () => api.get('/legal/admin/templates'),
  })

  const createDefaultsMutation = useMutation({
    mutationFn: () => api.post('/legal/admin/templates/defaults'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legalTemplates'] })
    },
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/legal/admin/templates/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legalTemplates'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/legal/admin/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legalTemplates'] })
    },
  })

  const templates: LegalTemplate[] = data?.data?.templates || []

  // Group templates by type
  const templatesByType = templates.reduce((acc, template) => {
    if (!acc[template.type]) {
      acc[template.type] = []
    }
    acc[template.type].push(template)
    return acc
  }, {} as Record<LegalTemplateType, LegalTemplate[]>)

  const hasTemplates = templates.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Legal Templates</h1>
          <p className="text-gray-600 mt-1">Manage your legal documents (ToS, Privacy Policy, Refund Policy)</p>
        </div>
        <div className="flex space-x-3">
          {!hasTemplates && (
            <button
              onClick={() => createDefaultsMutation.mutate()}
              disabled={createDefaultsMutation.isPending}
              className="flex items-center px-4 py-2 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
            >
              <FileText className="h-5 w-5 mr-2" />
              {createDefaultsMutation.isPending ? 'Creating...' : 'Create Defaults'}
            </button>
          )}
          <button
            onClick={() => {
              setEditingTemplate(null)
              setIsModalOpen(true)
            }}
            className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            New Template
          </button>
        </div>
      </div>

      {/* Templates Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : !hasTemplates ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No legal templates</h3>
          <p className="text-gray-500 mt-1">
            Create default templates or add your own custom templates
          </p>
          <button
            onClick={() => createDefaultsMutation.mutate()}
            disabled={createDefaultsMutation.isPending}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Create Default Templates
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(['terms_of_service', 'privacy_policy', 'refund_policy'] as LegalTemplateType[]).map((type) => {
            const typeTemplates = templatesByType[type] || []
            const activeTemplate = typeTemplates.find((t) => t.isActive)

            return (
              <div key={type} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">{TYPE_LABELS[type].en}</h3>
                      <p className="text-sm text-gray-500">{TYPE_LABELS[type].zh}</p>
                    </div>
                    {activeTemplate && (
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                        v{activeTemplate.version}
                      </span>
                    )}
                  </div>

                  {activeTemplate ? (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {activeTemplate.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        Updated: {new Date(activeTemplate.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No active template</p>
                  )}
                </div>

                <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-between">
                  <div className="flex space-x-2">
                    {activeTemplate && (
                      <>
                        <button
                          onClick={() => {
                            setEditingTemplate(activeTemplate)
                            setIsModalOpen(true)
                          }}
                          className="p-2 text-gray-500 hover:text-primary-600 rounded"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedType(type)
                            setShowHistory(true)
                          }}
                          className="p-2 text-gray-500 hover:text-primary-600 rounded"
                          title="Version History"
                        >
                          <History className="h-4 w-4" />
                        </button>
                        <a
                          href={`/api/v1/legal/${activeTemplate.id}/${type}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-gray-500 hover:text-primary-600 rounded"
                          title="View Public"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </>
                    )}
                  </div>
                  {!activeTemplate && (
                    <button
                      onClick={() => {
                        setEditingTemplate({ type } as LegalTemplate)
                        setIsModalOpen(true)
                      }}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      Create
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Template Editor Modal */}
      {isModalOpen && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={() => {
            setIsModalOpen(false)
            setEditingTemplate(null)
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['legalTemplates'] })
            setIsModalOpen(false)
            setEditingTemplate(null)
          }}
        />
      )}

      {/* Version History Modal */}
      {showHistory && selectedType && (
        <VersionHistoryModal
          type={selectedType}
          onClose={() => {
            setShowHistory(false)
            setSelectedType(null)
          }}
          onActivate={(id) => activateMutation.mutate(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      )}
    </div>
  )
}

// Template Editor Modal
interface TemplateEditorModalProps {
  template: LegalTemplate | null
  onClose: () => void
  onSuccess: () => void
}

function TemplateEditorModal({ template, onClose, onSuccess }: TemplateEditorModalProps) {
  const [type, setType] = useState<LegalTemplateType>(template?.type || 'terms_of_service')
  const [title, setTitle] = useState(template?.title || TYPE_LABELS[type].en)
  const [content, setContent] = useState(template?.content || '')
  const [language, setLanguage] = useState(template?.language || 'en')
  const [createNewVersion, setCreateNewVersion] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)

  // Load content if editing existing template
  const loadContent = async () => {
    if (template?.id && !template.content) {
      setLoadingContent(true)
      try {
        const response = await api.get(`/legal/admin/templates/${template.id}`)
        setContent(response.data.template.content || '')
      } catch (error) {
        console.error('Failed to load template content', error)
      } finally {
        setLoadingContent(false)
      }
    }
  }

  useState(() => {
    loadContent()
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (template?.id) {
        // Update existing
        await api.put(`/legal/admin/templates/${template.id}`, {
          title,
          content,
          language,
          createNewVersion,
        })
      } else {
        // Create new
        await api.post('/legal/admin/templates', {
          type,
          title,
          content,
          language,
        })
      }
      onSuccess()
    } catch (error) {
      console.error('Failed to save template', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {template?.id ? 'Edit Template' : 'Create Template'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => {
                  const newType = e.target.value as LegalTemplateType
                  setType(newType)
                  if (!template?.id) {
                    setTitle(TYPE_LABELS[newType].en)
                  }
                }}
                disabled={!!template?.id}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-gray-100"
              >
                <option value="terms_of_service">Terms of Service</option>
                <option value="privacy_policy">Privacy Policy</option>
                <option value="refund_policy">Refund Policy</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="en">English</option>
                <option value="zh">Chinese (中文)</option>
                <option value="ja">Japanese (日本語)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Content (Markdown supported)
            </label>
            {loadingContent ? (
              <div className="h-64 bg-gray-100 animate-pulse rounded-lg" />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                rows={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none font-mono text-sm"
                placeholder="# Title&#10;&#10;## Section 1&#10;&#10;Content here..."
              />
            )}
          </div>

          {template?.id && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="createNewVersion"
                checked={createNewVersion}
                onChange={(e) => setCreateNewVersion(e.target.checked)}
                className="h-4 w-4 text-primary-600 rounded border-gray-300"
              />
              <label htmlFor="createNewVersion" className="ml-2 text-sm text-gray-700">
                Create as new version (keeps previous version in history)
              </label>
            </div>
          )}
        </form>

        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !content}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Version History Modal
interface VersionHistoryModalProps {
  type: LegalTemplateType
  onClose: () => void
  onActivate: (id: string) => void
  onDelete: (id: string) => void
}

function VersionHistoryModal({ type, onClose, onActivate, onDelete }: VersionHistoryModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['legalTemplateHistory', type],
    queryFn: () => api.get(`/legal/admin/templates/${type}/history`),
  })

  const history: LegalTemplate[] = data?.data?.history || []

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Version History - {TYPE_LABELS[type].en}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No version history</p>
          ) : (
            <div className="space-y-3">
              {history.map((template) => (
                <div
                  key={template.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    template.isActive ? 'border-green-200 bg-green-50' : 'border-gray-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">Version {template.version}</span>
                      {template.isActive && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Created: {new Date(template.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    {!template.isActive && (
                      <>
                        <button
                          onClick={() => onActivate(template.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded"
                          title="Activate"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Delete this version?')) {
                              onDelete(template.id)
                            }
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
